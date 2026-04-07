import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

type AssistantIntent =
  | "create_task"
  | "create_note"
  | "get_dashboard_summary"
  | "get_tasks_overview"
  | "general_answer"
  | "unknown";

type AssistantAction = {
  intent: AssistantIntent;
  title: string | null;
  notes: string | null;
  due_date: string | null;
  time_text: string | null;
  note_title: string | null;
  note_content: string | null;
};

const monthIndexes: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const weekdayIndexes: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function toSentenceCase(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function createLocalDate(year: number, monthIndex: number, day: number) {
  const result = new Date(year, monthIndex, day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function normalizeSpacing(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function resolveWeekdayDate(
  weekdayName: string,
  modifier: string | undefined,
  referenceDate: Date,
) {
  const weekdayIndex = weekdayIndexes[weekdayName];

  if (weekdayIndex === undefined) {
    return null;
  }

  const result = new Date(referenceDate);
  result.setHours(0, 0, 0, 0);

  let difference = (weekdayIndex - result.getDay() + 7) % 7;

  if (modifier === "next" || modifier === "coming") {
    difference = difference === 0 ? 7 : difference;
  }

  result.setDate(result.getDate() + difference);
  return formatLocalDate(result);
}

function resolveExplicitDateFromMessage(message: string, referenceDate: Date) {
  const dayMonthYearPattern =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/i;
  const monthDayYearPattern =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i;

  const dayMonthYearMatch = message.match(dayMonthYearPattern);

  if (dayMonthYearMatch) {
    const day = Number(dayMonthYearMatch[1]);
    const monthIndex = monthIndexes[dayMonthYearMatch[2].toLowerCase()];
    let year = dayMonthYearMatch[3]
      ? Number(dayMonthYearMatch[3])
      : referenceDate.getFullYear();
    let result = createLocalDate(year, monthIndex, day);

    if (!dayMonthYearMatch[3] && result.getTime() < createLocalDate(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()).getTime()) {
      year += 1;
      result = createLocalDate(year, monthIndex, day);
    }

    return formatLocalDate(result);
  }

  const monthDayYearMatch = message.match(monthDayYearPattern);

  if (monthDayYearMatch) {
    const monthIndex = monthIndexes[monthDayYearMatch[1].toLowerCase()];
    const day = Number(monthDayYearMatch[2]);
    let year = monthDayYearMatch[3]
      ? Number(monthDayYearMatch[3])
      : referenceDate.getFullYear();
    let result = createLocalDate(year, monthIndex, day);

    if (!monthDayYearMatch[3] && result.getTime() < createLocalDate(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()).getTime()) {
      year += 1;
      result = createLocalDate(year, monthIndex, day);
    }

    return formatLocalDate(result);
  }

  return null;
}

function resolveDueDateFromMessage(message: string) {
  const loweredMessage = message.toLowerCase();
  const referenceDate = new Date();
  referenceDate.setHours(0, 0, 0, 0);

  const explicitDate = resolveExplicitDateFromMessage(message, referenceDate);

  if (explicitDate) {
    return explicitDate;
  }

  const weekdayMatch = loweredMessage.match(
    /\b(?:(next|this|coming)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );

  if (weekdayMatch) {
    return resolveWeekdayDate(weekdayMatch[2].toLowerCase(), weekdayMatch[1]?.toLowerCase(), referenceDate);
  }

  if (loweredMessage.includes("day after tomorrow")) {
    const result = new Date(referenceDate);
    result.setDate(result.getDate() + 2);
    return formatLocalDate(result);
  }

  if (loweredMessage.includes("tomorrow")) {
    const result = new Date(referenceDate);
    result.setDate(result.getDate() + 1);
    return formatLocalDate(result);
  }

  if (
    loweredMessage.includes("today") ||
    loweredMessage.includes("tonight") ||
    loweredMessage.includes("this evening") ||
    loweredMessage.includes("this afternoon") ||
    loweredMessage.includes("this morning")
  ) {
    return formatLocalDate(referenceDate);
  }

  return null;
}

function extractTimeTextFromMessage(message: string) {
  const timePatterns = [
    /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i,
    /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i,
    /\bat\s+(\d{1,2}:\d{2})\b/i,
    /\b(\d{1,2}:\d{2})\b/i,
  ];

  for (const pattern of timePatterns) {
    const match = message.match(pattern);

    if (match) {
      return normalizeSpacing(match[1].replace(/\./g, ""));
    }
  }

  return null;
}

function cleanTaskTitle(title: string) {
  const cleaned = normalizeSpacing(
    title
      .replace(/\bday after tomorrow\b/gi, "")
      .replace(/\btoday\b/gi, "")
      .replace(/\btomorrow\b/gi, "")
      .replace(/\btonight\b/gi, "")
      .replace(/\bthis (morning|afternoon|evening)\b/gi, "")
      .replace(/\b(?:next|this|coming)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
      .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
      .replace(/\bon\s+\d{1,2}(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?\b/gi, "")
      .replace(/\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, "")
      .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, "")
      .replace(/\bat\s+\d{1,2}:\d{2}\b/gi, "")
      .replace(/\s+at\s*$/gi, "")
      .replace(/\s+on\s*$/gi, "")
      .replace(/\s{2,}/g, " "),
  )
    .replace(/^[,.\-: ]+|[,.\-: ]+$/g, "");

  return cleaned || normalizeSpacing(title);
}

function mergeTaskNotes(notes: string, timeText: string | null) {
  const trimmedNotes = notes.trim();

  if (!timeText) {
    return trimmedNotes;
  }

  const timeLine = `Time: ${timeText}`;

  if (!trimmedNotes) {
    return timeLine;
  }

  if (trimmedNotes.toLowerCase().includes(timeText.toLowerCase())) {
    return trimmedNotes;
  }

  return `${trimmedNotes}\n${timeLine}`;
}

function isQuestionLikeMessage(message: string) {
  const trimmed = message.trim().toLowerCase();

  return (
    trimmed.includes("?") ||
    /^(what|how|when|where|why|who|which|can|could|would|will|is|are|do|does|did|tell me|show me|list)\b/.test(
      trimmed,
    )
  );
}

function isTaskQuestion(message: string) {
  const loweredMessage = message.toLowerCase();

  return (
    isQuestionLikeMessage(message) &&
    (loweredMessage.includes("task") ||
      loweredMessage.includes("tasks") ||
      loweredMessage.includes("pending") ||
      loweredMessage.includes("completed") ||
      loweredMessage.includes("today") ||
      loweredMessage.includes("tomorrow") ||
      loweredMessage.includes("upcoming"))
  );
}

function buildTaskOverviewReply(tasks: Array<{ title: string; due_date: string | null; status: string }>) {
  if (tasks.length === 0) {
    return "I could not find any matching tasks.";
  }

  const preview = tasks
    .slice(0, 5)
    .map((task) => {
      const dateLabel = task.due_date ? ` on ${task.due_date}` : "";
      return `${task.title}${dateLabel}`;
    })
    .join(", ");

  if (tasks.length === 1) {
    return `I found 1 matching task: ${preview}.`;
  }

  const extraCount = tasks.length - 5;
  return `I found ${tasks.length} matching tasks: ${preview}${extraCount > 0 ? `, and ${extraCount} more` : ""}.`;
}

function extractTaskNotes(message: string) {
  const noteMarkers = [" add notes ", " notes ", " note ", " details "];
  const loweredMessage = ` ${message.toLowerCase()} `;

  for (const marker of noteMarkers) {
    const markerIndex = loweredMessage.indexOf(marker);

    if (markerIndex === -1) {
      continue;
    }

    const originalStart = markerIndex;
    const originalEnd = markerIndex + marker.trim().length;
    const title = message.slice(0, originalStart).trim();
    const notes = message.slice(originalEnd).trim();

    return {
      title,
      notes,
    };
  }

  return {
    title: message.trim(),
    notes: "",
  };
}

function parseAssistantActionFallback(
  message: string,
): AssistantAction {
  const trimmedMessage = message.trim();
  const loweredMessage = trimmedMessage.toLowerCase();
  const dueDate = resolveDueDateFromMessage(trimmedMessage);
  const timeText = extractTimeTextFromMessage(trimmedMessage);

  if (
    loweredMessage.includes("dashboard summary") ||
    loweredMessage.includes("summary of my dashboard") ||
    loweredMessage.includes("how many pending tasks") ||
    loweredMessage.includes("how many tasks") ||
    loweredMessage.includes("what is on my dashboard")
  ) {
    return {
      intent: "get_dashboard_summary",
      title: null,
      notes: null,
      due_date: null,
      time_text: null,
      note_title: null,
      note_content: null,
    };
  }

  if (isTaskQuestion(trimmedMessage)) {
    return {
      intent: "get_tasks_overview",
      title: null,
      notes: null,
      due_date: dueDate,
      time_text: timeText,
      note_title: null,
      note_content: null,
    };
  }

  if (
    loweredMessage.startsWith("create note ") ||
    loweredMessage.startsWith("add note ") ||
    loweredMessage.startsWith("save note ")
  ) {
    const noteBody = trimmedMessage
      .replace(/^create note\s+/i, "")
      .replace(/^add note\s+/i, "")
      .replace(/^save note\s+/i, "")
      .trim();

    return {
      intent: "create_note",
      title: null,
      notes: null,
      due_date: null,
      time_text: null,
      note_title: noteBody ? toSentenceCase(noteBody.split(".")[0].trim()) : "Untitled Note",
      note_content: noteBody,
    };
  }

  const looksLikeTaskRequest =
    loweredMessage.startsWith("add task ") ||
    loweredMessage.startsWith("create task ") ||
    loweredMessage.startsWith("add a task ") ||
    loweredMessage.startsWith("task ") ||
    loweredMessage.startsWith("remind ") ||
    (dueDate !== null && !isQuestionLikeMessage(loweredMessage));

  if (looksLikeTaskRequest) {
    const cleanedMessage = trimmedMessage
      .replace(/^add a task to\s+/i, "")
      .replace(/^add a task\s+/i, "")
      .replace(/^add task\s+/i, "")
      .replace(/^create task\s+/i, "")
      .replace(/^task\s+/i, "")
      .replace(/^remind me to\s+/i, "")
      .replace(/^remind\s+/i, "")
      .trim();

    const extractedTask = extractTaskNotes(cleanedMessage);
    const cleanedTitle = cleanTaskTitle(extractedTask.title);

    return {
      intent: "create_task",
      title: cleanedTitle ? toSentenceCase(cleanedTitle) : null,
      notes: mergeTaskNotes(extractedTask.notes, timeText),
      due_date: dueDate,
      time_text: timeText,
      note_title: null,
      note_content: null,
    };
  }

  return {
    intent: "unknown",
    title: null,
    notes: null,
    due_date: null,
    time_text: null,
    note_title: null,
    note_content: null,
  };
}

function getOpenAIClient() {
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    return null;
  }

  return new OpenAI({ apiKey: openaiApiKey });
}

function isToday(dueDate: string | null) {
  if (!dueDate) {
    return false;
  }

  const today = new Date();
  const parsedDate = new Date(dueDate);

  return parsedDate.toDateString() === today.toDateString();
}

function isFutureDate(dueDate: string | null) {
  if (!dueDate) {
    return false;
  }

  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);

  const parsedDate = new Date(dueDate);
  parsedDate.setHours(0, 0, 0, 0);

  return parsedDate.getTime() > currentDate.getTime();
}

async function createGeneralAssistantReply(client: OpenAI | null, message: string) {
  if (!client) {
    return "I can help with tasks, notes, and dashboard questions right now. Ask me to add a task, save a note, or summarize your dashboard.";
  }

  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a helpful personal assistant inside a dashboard app. " +
              "Answer clearly and briefly in a friendly tone. " +
              "If the user asks about what you can do, explain your current capabilities simply.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    ],
  });

  return response.output_text.trim();
}

export async function POST(request: Request) {
  try {
    const client = getOpenAIClient();
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const supabase = createSupabaseServerClient(accessToken || undefined);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { message } = (await request.json()) as { message?: string };

    if (!message?.trim()) {
      return NextResponse.json(
        {
          success: false,
          intent: "unknown",
          assistantReply: "Message is required.",
        },
        { status: 400 },
      );
    }

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          intent: "unknown",
          assistantReply: "Please sign in to use the assistant for your own data.",
          errorDetail: "Missing authenticated user.",
        },
        { status: 401 },
      );
    }

    console.log("[assistant] outgoing message:", message);

    let action: AssistantAction;

    try {
      if (!client) {
        throw new Error("Missing OPENAI_API_KEY");
      }

      const openaiResponse = await client.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are an assistant action parser for a personal assistant app. " +
                  "Return exactly one structured action. Supported intents are create_task, create_note, get_dashboard_summary, general_answer, and unknown. " +
                  "Use get_tasks_overview when the user is asking to see or summarize tasks instead of creating one. " +
                  "For create_task, extract title, notes, due_date, and time_text when present. Resolve words like today, tomorrow, next Monday, Friday, and explicit dates like 6th April 2026 to YYYY-MM-DD. " +
                  "Capture times like 4 pm, 4:30 p.m., or 16:30 in time_text. " +
                  "If no notes are present, return notes as an empty string. " +
                  "For create_note, extract note_title and note_content. " +
                  "Use general_answer for questions that should be answered conversationally instead of changing data. " +
                  "If the request does not match a supported action, return unknown.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: message,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "assistant_action",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                intent: {
                  type: "string",
                enum: [
                  "create_task",
                  "create_note",
                  "get_dashboard_summary",
                  "get_tasks_overview",
                  "general_answer",
                  "unknown",
                ],
                },
                title: {
                  type: ["string", "null"],
                },
                notes: {
                  type: ["string", "null"],
                },
                due_date: {
                  type: ["string", "null"],
                },
                time_text: {
                  type: ["string", "null"],
                },
                note_title: {
                  type: ["string", "null"],
                },
                note_content: {
                  type: ["string", "null"],
                },
              },
              required: [
                "intent",
                "title",
                "notes",
                "due_date",
                "time_text",
                "note_title",
                "note_content",
              ],
            },
          },
        },
      });

      action = JSON.parse(openaiResponse.output_text) as AssistantAction;
    } catch (openaiError) {
      console.error("[assistant] openai parse failed, using fallback:", openaiError);
      action = parseAssistantActionFallback(message);
    }

    console.log("[assistant] interpreted action:", action);

    if (action.intent === "create_task" && action.title?.trim()) {
      const status = isToday(action.due_date) ? "today" : "pending";
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          title: action.title.trim(),
          notes: mergeTaskNotes(action.notes?.trim() ?? "", action.time_text),
          status,
          due_date: action.due_date,
        })
        .select("id, title, status, notes, created_at, due_date")
        .single();

      console.log("[assistant] supabase insert task result:", { data, error });

      if (error) {
        return NextResponse.json(
          {
            success: false,
            intent: action.intent,
            assistantReply: "Could not create task.",
            errorDetail: error.message,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        intent: action.intent,
        assistantReply: action.notes?.trim()
          ? "Done - I added that task with notes."
          : "Done - I added that task.",
        createdTask: data,
      });
    }

    if (action.intent === "create_note") {
      const title = action.note_title?.trim() || "Untitled Note";
      const content = action.note_content?.trim() || "";

      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          title,
          content,
          created_at: new Date().toISOString(),
        })
        .select("id, title, content, created_at")
        .single();

      console.log("[assistant] supabase insert note result:", { data, error });

      if (error) {
        return NextResponse.json(
          {
            success: false,
            intent: action.intent,
            assistantReply: "Could not create note.",
            errorDetail: error.message,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        intent: action.intent,
        assistantReply: "Done - I saved that note.",
        createdNote: data,
      });
    }

    if (action.intent === "get_dashboard_summary") {
      const [pendingResult, todayResult] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, due_date")
          .eq("status", "pending"),
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("status", "today"),
      ]);

      if (pendingResult.error || todayResult.error) {
        return NextResponse.json(
          {
            success: false,
            intent: action.intent,
            assistantReply: "Could not load the dashboard summary.",
            errorDetail: pendingResult.error?.message ?? todayResult.error?.message,
          },
          { status: 500 },
        );
      }

      const pendingCount =
        pendingResult.data?.filter((task) => !isFutureDate(task.due_date)).length ?? 0;
      const upcomingCount =
        pendingResult.data?.filter((task) => isFutureDate(task.due_date)).length ?? 0;

      return NextResponse.json({
        success: true,
        intent: action.intent,
        assistantReply: `You have ${pendingCount} pending tasks, ${todayResult.count ?? 0} task due today, and ${upcomingCount} upcoming task${upcomingCount === 1 ? "" : "s"}.`,
      });
    }

    if (action.intent === "get_tasks_overview") {
      let query = supabase
        .from("tasks")
        .select("title, due_date, status")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });

      const loweredMessage = message.toLowerCase();

      if (action.due_date) {
        if (isToday(action.due_date)) {
          query = query.in("status", ["today", "pending"]).eq("due_date", action.due_date);
        } else {
          query = query.eq("due_date", action.due_date);
        }
      } else if (loweredMessage.includes("completed")) {
        query = query.eq("status", "completed");
      } else if (loweredMessage.includes("upcoming")) {
        query = query.eq("status", "pending").gte("due_date", new Date().toISOString().slice(0, 10));
      } else if (loweredMessage.includes("pending")) {
        query = query.eq("status", "pending");
      } else if (loweredMessage.includes("today")) {
        query = query.in("status", ["today", "pending"]).eq("due_date", new Date().toISOString().slice(0, 10));
      } else {
        query = query.neq("status", "completed");
      }

      const { data, error } = await query.limit(10);

      if (error) {
        return NextResponse.json(
          {
            success: false,
            intent: action.intent,
            assistantReply: "Could not load matching tasks right now.",
            errorDetail: error.message,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        intent: action.intent,
        assistantReply: buildTaskOverviewReply(data ?? []),
      });
    }

    if (action.intent === "general_answer" || action.intent === "unknown") {
      try {
        const generalReply = await createGeneralAssistantReply(client, message);

        return NextResponse.json({
          success: true,
          intent: "unknown",
          assistantReply:
            generalReply ||
            "I can help with tasks, notes, and dashboard questions right now.",
        });
      } catch (generalAnswerError) {
        console.error("[assistant] general answer failed:", generalAnswerError);
      }
    }

    return NextResponse.json({
      success: true,
      intent: "unknown",
      assistantReply:
        "I understood your message, but I could not match it to a supported assistant action yet.",
    });
  } catch (error) {
    console.error("[assistant] route error:", error);

    return NextResponse.json(
      {
        success: false,
        intent: "unknown",
        assistantReply: "The assistant route failed while processing your message.",
        errorDetail:
          error instanceof Error ? error.message : "Unknown route error.",
      },
      { status: 500 },
    );
  }
}
