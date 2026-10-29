/** Optional JSON backend adapter. Authentication and LLM credentials belong on
 * the backend. Nothing is called until this adapter is installed and Send used.
 * POST endpoint: {messages: [{role, content}], context}
 * Response: {content: string}
 */
export function createHttpAgentTransport(endpoint = '/api/agent/chat') {
  return {
    async send({ messages, context, signal }) {
      const response = await fetch(endpoint, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, context }),
      });
      if (!response.ok) throw new Error(`Agent request failed (HTTP ${response.status}).`);
      const result = await response.json();
      if (typeof result.content !== 'string') throw new Error('Agent response must contain a content string.');
      return result.content;
    },
  };
}
