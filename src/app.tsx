import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useEffect, useRef, type SubmitEvent } from "react";

export default function MovieBotApp() {
  const agent = useAgent({ agent: "ChatAgent" });
  const { messages, sendMessage, status } = useAgentChat({ agent });
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    
    const form = e.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem("input") as HTMLInputElement;
    const text = input.value.trim();
    
    if (text) {
      input.value = "";
      sendMessage({ text });
    }
  };

  // Determine if the assistant is still processing (either streaming or waiting for a response after a user message)
  const isWaitingForResponse = status === "streaming" || (messages.length > 0 && messages[messages.length - 1].role === 'user');

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto bg-gray-50 border-x shadow-lg font-sans">
      
      {/* Header */}
      <header className="bg-slate-900 text-white p-4 shadow-md z-10 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Cinematic Oracle</h1>
          <p className="text-sm text-slate-300">Connected to Public Movie MCP</p>
        </div>
        <div className={`text-xs px-2 py-1 rounded-full ${status === 'ready' ? 'bg-green-500' : 'bg-yellow-500'}`}>
          {status}
        </div>
      </header>

      {/* Chat Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-10">
            <p className="text-lg mb-2">🎬 Welcome to the Movie Recommender</p>
            <p className="text-sm">Ask for suggestions by genre, director, era, or mood.</p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div 
              className={`max-w-[85%] p-3 rounded-lg ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-br-none' 
                  : 'bg-white border text-gray-800 rounded-bl-none shadow-sm'
              }`}
            >
              <div className="text-xs font-semibold mb-1 opacity-75">
                {msg.role === 'user' ? 'You' : 'Director Bot'}
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">
                {msg.parts.map((part, i) =>
                  part.type === "text" ? <span key={i}>{part.text}</span> : null
                )}
              </div>
            </div>
          </div>
        ))}
        
        {/* Smart Loading Indicator during tool calls or response lags */}
        {isWaitingForResponse && (
          <div className="flex justify-start">
            <div className="bg-white border text-gray-500 p-3 rounded-lg rounded-bl-none shadow-sm flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full animate-ping"></span>
              <span className="animate-pulse">Consulting the movie archives & running tools...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form
        className="p-4 bg-white border-t flex gap-2"
        onSubmit={handleSubmit}
      >
        <input 
          name="input" 
          className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., Recommend action movies from 90s..." 
          autoComplete="off"
          autoFocus
        />
        <button 
          type="submit" 
          disabled={status !== "ready"}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}