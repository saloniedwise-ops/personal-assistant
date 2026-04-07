import { NextResponse } from "next/server";
import { getIntegrationStatus } from "@/lib/integrations";

export async function POST(request: Request) {
  const status = getIntegrationStatus("Google Calendar");
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    dueDate?: string;
    notes?: string;
  };

  if (!status.configured) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Google Calendar is not configured yet. Add the required environment variables first.",
        missingKeys: status.missingKeys,
      },
      { status: 501 },
    );
  }

  return NextResponse.json({
    success: true,
    message:
      "Google Calendar integration scaffold is ready. Connect the real provider logic in this route next.",
    preview: {
      title: body.title ?? "Untitled event",
      dueDate: body.dueDate ?? null,
      notes: body.notes ?? "",
    },
  });
}
