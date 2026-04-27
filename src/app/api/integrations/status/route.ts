import { NextResponse } from "next/server";
import { getIntegrationStatuses } from "@/lib/integrations";

export async function GET() {
  return NextResponse.json({
    success: true,
    integrations: getIntegrationStatuses(),
  });
}
