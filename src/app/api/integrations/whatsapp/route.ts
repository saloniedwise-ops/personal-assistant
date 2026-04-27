import { NextResponse } from "next/server";
import { getIntegrationStatus } from "@/lib/integrations";

export async function POST(request: Request) {
  const status = getIntegrationStatus("WhatsApp");
  const body = (await request.json().catch(() => ({}))) as {
    to?: string;
    message?: string;
  };

  if (!status.configured) {
    return NextResponse.json(
      {
        success: false,
        message:
          "WhatsApp integration is not configured yet. Add the required environment variables first.",
        missingKeys: status.missingKeys,
      },
      { status: 501 },
    );
  }

  return NextResponse.json({
    success: true,
    message:
      "WhatsApp integration scaffold is ready. Connect your provider send logic in this route next.",
    preview: {
      to: body.to ?? "",
      message: body.message ?? "",
    },
  });
}
