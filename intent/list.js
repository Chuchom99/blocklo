// WhatsApp list message (up to 10 rows), used when there are more than 3 choices.
export function listMessage(body, buttonLabel, rows) {
  return {
    type: "interactive",
    payload: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonLabel.slice(0, 20),
        sections: [
          {
            title: "Options",
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id.slice(0, 200),
              title: r.title.slice(0, 24),
              ...(r.description && { description: r.description.slice(0, 72) }),
            })),
          },
        ],
      },
    },
  };
}
