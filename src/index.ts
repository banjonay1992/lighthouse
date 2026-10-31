export default {
  async fetch(): Promise<Response> {
    return Response.json({ ok: true });
  },
} satisfies ExportedHandler;
