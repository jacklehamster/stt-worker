export default {
  async fetch(request: Request, env: any): Promise<Response> {
    return new Response("Hello World", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
