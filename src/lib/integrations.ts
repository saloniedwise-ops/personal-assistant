export type IntegrationName = "Google Calendar" | "Email" | "WhatsApp";

export type IntegrationStatus = {
  name: IntegrationName;
  configured: boolean;
  summary: string;
  missingKeys: string[];
};

type IntegrationConfig = {
  name: IntegrationName;
  requiredKeys: string[];
};

const integrationConfigs: IntegrationConfig[] = [
  {
    name: "Google Calendar",
    requiredKeys: [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "GOOGLE_REFRESH_TOKEN",
      "GOOGLE_CALENDAR_ID",
    ],
  },
  {
    name: "Email",
    requiredKeys: [
      "MAIL_PROVIDER",
      "MAIL_FROM_EMAIL",
      "MAIL_API_KEY",
    ],
  },
  {
    name: "WhatsApp",
    requiredKeys: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_WHATSAPP_FROM",
    ],
  },
];

function missingKeys(requiredKeys: string[]) {
  return requiredKeys.filter((key) => !process.env[key]);
}

export function getIntegrationStatuses(): IntegrationStatus[] {
  return integrationConfigs.map((config) => {
    const missing = missingKeys(config.requiredKeys);
    const configured = missing.length === 0;

    return {
      name: config.name,
      configured,
      summary: configured
        ? `${config.name} is ready to connect.`
        : `Add ${missing.length} environment variable${missing.length === 1 ? "" : "s"} to finish setup.`,
      missingKeys: missing,
    };
  });
}

export function getIntegrationStatus(name: IntegrationName) {
  return (
    getIntegrationStatuses().find((status) => status.name === name) ?? {
      name,
      configured: false,
      summary: "Integration is not available.",
      missingKeys: [],
    }
  );
}
