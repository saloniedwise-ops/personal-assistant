import { NextResponse } from "next/server";
import { getIntegrationStatus } from "@/lib/integrations";

export async function POST(request: Request) {
  const status = getIntegrationStatus("Email");
  const body = (await request.json().catch(() => ({}))) as {
    to?: string;
    subject?: string;
    content?: string;
  };

  if (!status.configured) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Email integration is not configured yet. Add the required environment variables first.",
        missingKeys: status.missingKeys,
      },
      { status: 501 },
    );
  }

  return NextResponse.json({
    success: true,
    message:
      "Email integration scaffold is ready. Connect your provider send logic in this route next.",
    preview: {
      to: body.to ?? "",
      subject: body.subject ?? "",
      content: body.content ?? "",
    },
  });
}
