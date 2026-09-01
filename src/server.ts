import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, tool } from "ai";
import { z } from "zod";
import { routeAgentRequest } from "agents";

export class ChatAgent extends AIChatAgent {
  async onChatMessage() {
    const workersai = createWorkersAI({ binding: this.env.AI });

    // Base headers for all TMDB requests
    const tmdbHeaders = {
      "Accept": "application/json",
      "Authorization": `Bearer ${this.env.TMDB_API_KEY}`
    };

    const tmdbTools = {
      // 1. STANDARD TITLE SEARCH
      tmdb_search_titles: tool({
        description: "Search for specific movies by their title.",
        inputSchema: z.object({
          query: z.string().describe("The movie title to search for"),
        }),
        execute: async ({ query }) => {
          const res = await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`, { headers: tmdbHeaders });
          const data = await res.json();
          // Prune data to save LLM context window
          return { results: (data.results || []).slice(0, 5).map((m: any) => ({ id: m.id, title: m.title, release_date: m.release_date, overview: m.overview })) };
        },
      }),

      // 2. DISCOVER & GENRE FILTERING (Great for Arthouse, specific decades, etc.)
      tmdb_discover_movies: tool({
  description: "Discover or recommend movies based on genre, release year, or rating.",
  inputSchema: z.object({
    genre: z.enum(['action', 'adventure', 'animation', 'comedy', 'crime', 'documentary', 'drama', 'family', 'fantasy', 'history', 'horror', 'music', 'mystery', 'romance', 'scifi', 'thriller', 'war', 'western']).describe("Genre to search for").optional(),
    year: z.number().optional().describe("Specific release year (e.g., 1999)"),
    min_rating: z.number().optional().describe("Minimum user rating from 1 to 10 (e.g., 7.5)"),
    sort_by: z.enum(['popularity.desc', 'vote_average.desc', 'revenue.desc']).default('popularity.desc')
  }),
  execute: async ({ genre, year, min_rating, sort_by }) => {
    // Official TMDb Genre ID Map
    const TMDB_GENRES: Record<string, number> = {
      action: 28,
      adventure: 12,
      animation: 16,
      comedy: 35,
      crime: 80,
      documentary: 99,
      drama: 18,
      family: 10751,
      fantasy: 14,
      history: 36,
      horror: 27,
      music: 10402,
      mystery: 9648,
      romance: 10749,
      scifi: 878,
      thriller: 53,
      war: 10752,
      western: 37
    };

    let url = `https://api.themoviedb.org/3/discover/movie?include_adult=false&language=en-US&page=1&sort_by=${sort_by}&vote_count.gte=50`;
    
    if (genre && TMDB_GENRES[genre]) {
      url += `&with_genres=${TMDB_GENRES[genre]}`;
    }
    if (year) {
      url += `&primary_release_year=${year}`;
    }
    if (min_rating) {
      url += `&vote_average.gte=${min_rating}`;
    }

    const res = await fetch(url, { headers: tmdbHeaders });
    const data = await res.json();
    
    return { 
      results: (data.results || []).slice(0, 8).map((m: any) => ({ 
        id: m.id, 
        title: m.title, 
        rating: m.vote_average, 
        release_date: m.release_date,
        overview: m.overview 
      })) 
    };
  },
}),

      // 3. MOVIES BY ACTOR OR DIRECTOR
      tmdb_movies_by_person: tool({
        description: "Find movies starring a specific actor or directed by a specific director.",
        inputSchema: z.object({
          person_name: z.string().describe("Name of the actor or director"),
          role: z.enum(['actor', 'director'])
        }),
        execute: async ({ person_name, role }) => {
          // Step 1: Find the person's TMDB ID
          const personRes = await fetch(`https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(person_name)}`, { headers: tmdbHeaders });
          const personData = await personRes.json();
          
          if (!personData.results || personData.results.length === 0) {
            return { error: `Could not find any person named ${person_name}` };
          }
          const personId = personData.results[0].id;

          // Step 2: Fetch movies using their ID
          const filterParam = role === 'actor' ? 'with_cast' : 'with_crew';
          const movieRes = await fetch(`https://api.themoviedb.org/3/discover/movie?${filterParam}=${personId}&sort_by=popularity.desc`, { headers: tmdbHeaders });
          const movieData = await movieRes.json();
          
          return { 
            person_found: personData.results[0].name,
            results: (movieData.results || []).slice(0, 8).map((m: any) => ({ id: m.id, title: m.title, release_date: m.release_date })) 
          };
        },
      }),

      // 4. MOVIE DEEP DIVE (Get streaming platforms & runtime)
      tmdb_movie_details: tool({
        description: "Get deep details for a specific movie using its ID, including where it is streaming.",
        inputSchema: z.object({
          movie_id: z.number().describe("The TMDB movie ID"),
        }),
        execute: async ({ movie_id }) => {
          // append_to_response fetches providers and credits in a single network request!
          const res = await fetch(`https://api.themoviedb.org/3/movie/${movie_id}?append_to_response=watch/providers,credits`, { headers: tmdbHeaders });
          const data = await res.json();
          
          return {
            title: data.title,
            runtime: data.runtime,
            genres: data.genres?.map((g: any) => g.name),
            director: data.credits?.crew?.find((c: any) => c.job === "Director")?.name,
            streaming_US: data["watch/providers"]?.results?.US?.flatrate?.map((p: any) => p.provider_name) || "Not streaming on major platforms",
          };
        },
      })
    };

    const result = streamText({
      model: workersai("@cf/zai-org/glm-4.7-flash"),
      messages: await convertToModelMessages(this.messages),
      tools: tmdbTools,
      // CRITICAL: maxSteps allows the AI to call multiple tools in one turn
      // (e.g., 1. search for a movie -> 2. get its ID -> 3. check where it's streaming)
      maxSteps: 5, 
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const agentResponse = await routeAgentRequest(request, env); 
    if (agentResponse) { 
      return agentResponse;
    }

    // 2. If it's NOT an agent request, serve your React frontend!
    // (This requires the "assets" binding in your wrangler.jsonc)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    
    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;