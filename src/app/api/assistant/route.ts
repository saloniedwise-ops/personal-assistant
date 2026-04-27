import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

type TaskStatus = "today" | "pending" | "completed";

type AssistantIntent =
  | "create_task"
  | "update_task"
  | "delete_task"
  | "complete_task"
  | "reopen_task"
  | "add_update_notes"
  | "update_due_date"
  | "rename_task"
  | "create_note"
  | "get_dashboard_summary"
  | "get_tasks_overview"
  | "general_answer"
  | "unknown";

type AssistantAction = {
  intent: AssistantIntent;
  title: string | null;
  target_task_query: string | null;
  new_title: string | null;
  notes: string | null;
  due_date: string | null;
  time_text: string | null;
  note_title: string | null;
  note_content: string | null;
  assistant_reply: string | null;
};

type TaskRow = {
  id: number;
  title: string;
  status: TaskStatus;
  notes: string;
  due_date: string | null;
  created_at: string;
};

const userTimeZone = "Asia/Calcutta";

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

function getOpenAIClient() {
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    return null;
  }

  return new OpenAI({ apiKey: openaiApiKey });
}

function formatDateParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getTodayParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: userTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function getTodayDate() {
  const today = getTodayParts();
  return formatDateParts(today.year, today.month, today.day);
}

function dateFromYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addDays(dateText: string, days: number) {
  const date = dateFromYmd(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function normalizeSpacing(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toSentenceCase(value: string) {
  const cleanedValue = normalizeSpacing(value);

  if (!cleanedValue) {
    return cleanedValue;
  }

  return cleanedValue.charAt(0).toUpperCase() + cleanedValue.slice(1);
}

function resolveWeekdayDate(
  weekdayName: string,
  modifier: string | undefined,
  referenceDateText: string,
) {
  const weekdayIndex = weekdayIndexes[weekdayName];

  if (weekdayIndex === undefined) {
    return null;
  }

  const referenceDate = dateFromYmd(referenceDateText);
  let difference = (weekdayIndex - referenceDate.getUTCDay() + 7) % 7;

  if (modifier === "next" || modifier === "coming") {
    difference = difference === 0 ? 7 : difference;
  }

  return addDays(referenceDateText, difference);
}

function resolveExplicitDate(message: string, referenceDateText: string) {
  const dayMonthYearPattern =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/i;
  const monthDayYearPattern =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i;
  const referenceDate = dateFromYmd(referenceDateText);

  const buildDate = (year: number, monthIndex: number, day: number) => {
    const result = new Date(Date.UTC(year, monthIndex, day, 12));

    if (result.getTime() < referenceDate.getTime()) {
      result.setUTCFullYear(result.getUTCFullYear() + 1);
    }

    return formatDateParts(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
  };

  const dayMonthYearMatch = message.match(dayMonthYearPattern);

  if (dayMonthYearMatch) {
    const monthIndex = monthIndexes[dayMonthYearMatch[2].toLowerCase()];
    const year = dayMonthYearMatch[3]
      ? Number(dayMonthYearMatch[3])
      : referenceDate.getUTCFullYear();

    return buildDate(year, monthIndex, Number(dayMonthYearMatch[1]));
  }

  const monthDayYearMatch = message.match(monthDayYearPattern);

  if (monthDayYearMatch) {
    const monthIndex = monthIndexes[monthDayYearMatch[1].toLowerCase()];
    const year = monthDayYearMatch[3]
      ? Number(monthDayYearMatch[3])
      : referenceDate.getUTCFullYear();

    return buildDate(year, monthIndex, Number(monthDayYearMatch[2]));
  }

  return null;
}

function normalizeDueDate(value: string | null, originalMessage: string) {
  const referenceDateText = getTodayDate();
  const dateSource = `${value ?? ""} ${originalMessage}`.toLowerCase();
  const explicitDate = resolveExplicitDate(dateSource, referenceDateText);

  if (explicitDate) {
    return explicitDate;
  }

  const isoDate = dateSource.match(/\b(\d{4}-\d{2}-\d{2})\b/);

  if (isoDate) {
    return isoDate[1];
  }

  const weekdayMatch = dateSource.match(
    /\b(?:(next|this|coming)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );

  if (weekdayMatch) {
    return resolveWeekdayDate(
      weekdayMatch[2].toLowerCase(),
      weekdayMatch[1]?.toLowerCase(),
      referenceDateText,
    );
  }

  if (dateSource.includes("day after tomorrow")) {
    return addDays(referenceDateText, 2);
  }

  if (dateSource.includes("tomorrow")) {
    return addDays(referenceDateText, 1);
  }

  if (
    dateSource.includes("today") ||
    dateSource.includes("tonight") ||
    dateSource.includes("this morning") ||
    dateSource.includes("this afternoon") ||
    dateSource.includes("this evening")
  ) {
    return referenceDateText;
  }

  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function extractTimeText(message: string, timeText: string | null) {
  if (timeText?.trim()) {
    return normalizeSpacing(timeText.replace(/\./g, ""));
  }

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

function appendTaskNotes(existingNotes: string, nextNotes: string) {
  const cleanedExistingNotes = existingNotes.trim();
  const cleanedNextNotes = nextNotes.trim();

  if (!cleanedExistingNotes) {
    return cleanedNextNotes;
  }

  if (!cleanedNextNotes) {
    return cleanedExistingNotes;
  }

  return `${cleanedExistingNotes}\n${cleanedNextNotes}`;
}

function cleanTaskTitle(title: string) {
  return normalizeSpacing(
    title
      .replace(/\bday after tomorrow\b/gi, "")
      .replace(/\btoday\b/gi, "")
      .replace(/\btomorrow\b/gi, "")
      .replace(/\btonight\b/gi, "")
      .replace(/\bthis (morning|afternoon|evening)\b/gi, "")
      .replace(/\b(?:next|this|coming)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
      .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
      .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, "")
      .replace(/\bat\s+\d{1,2}:\d{2}\b/gi, "")
      .replace(/^[,.\-: ]+|[,.\-: ]+$/g, ""),
  );
}

function isToday(dueDate: string | null) {
  return dueDate === getTodayDate();
}

function isFutureDate(dueDate: string | null) {
  if (!dueDate) {
    return false;
  }

  return dateFromYmd(dueDate).getTime() > dateFromYmd(getTodayDate()).getTime();
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

function fallbackAction(message: string): AssistantAction {
  const loweredMessage = message.toLowerCase();
  const dueDate = normalizeDueDate(null, message);
  const timeText = extractTimeText(message, null);

  if (loweredMessage.includes("dashboard summary") || loweredMessage.includes("summary of my dashboard")) {
    return emptyAction("get_dashboard_summary");
  }

  if (isQuestionLikeMessage(message) && loweredMessage.includes("task")) {
    return {
      ...emptyAction("get_tasks_overview"),
      due_date: dueDate,
    };
  }

  if (loweredMessage.startsWith("delete ") || loweredMessage.startsWith("remove ")) {
    return {
      ...emptyAction("delete_task"),
      target_task_query: cleanTaskTitle(
        message.replace(/^(delete|remove)\s+(the\s+)?/i, "").replace(/\s+task$/i, ""),
      ),
    };
  }

  if (loweredMessage.includes("complete") || loweredMessage.includes("done")) {
    return {
      ...emptyAction("complete_task"),
      target_task_query: cleanTaskTitle(message.replace(/\b(mark|task|complete|completed|done)\b/gi, "")),
    };
  }

  if (loweredMessage.includes("reopen") || loweredMessage.includes("pending")) {
    return {
      ...emptyAction("reopen_task"),
      target_task_query: cleanTaskTitle(message.replace(/\b(mark|task|reopen|pending|back|to)\b/gi, "")),
    };
  }

  if (loweredMessage.includes("add note") || loweredMessage.includes("add notes")) {
    const [targetText, notesText] = message.split(/:\s+| add notes? /i);

    return {
      ...emptyAction("add_update_notes"),
      target_task_query: cleanTaskTitle(targetText.replace(/add notes? to/i, "")),
      notes: notesText?.trim() ?? null,
    };
  }

  if (
    loweredMessage.startsWith("add task ") ||
    loweredMessage.startsWith("create task ") ||
    loweredMessage.startsWith("remind ") ||
    (dueDate && !isQuestionLikeMessage(message))
  ) {
    const title = cleanTaskTitle(
      message
        .replace(/^add task\s+/i, "")
        .replace(/^create task\s+/i, "")
        .replace(/^remind me to\s+/i, "")
        .replace(/^remind\s+/i, ""),
    );

    return {
      ...emptyAction("create_task"),
      title: toSentenceCase(title),
      due_date: dueDate,
      time_text: timeText,
    };
  }

  return {
    ...emptyAction("general_answer"),
    assistant_reply: "I can help answer questions and manage your tasks. Try asking me to add, rename, complete, reopen, move, delete, or add notes to a task.",
  };
}

function parseFastTaskAction(message: string): AssistantAction | null {
  const trimmedMessage = normalizeSpacing(message);
  const loweredMessage = trimmedMessage.toLowerCase();
  const dueDate = normalizeDueDate(null, trimmedMessage);
  const timeText = extractTimeText(trimmedMessage, null);

  if (
    loweredMessage.includes("dashboard summary") ||
    loweredMessage.includes("summary of my dashboard") ||
    loweredMessage.includes("how many tasks")
  ) {
    return emptyAction("get_dashboard_summary");
  }

  if (isQuestionLikeMessage(trimmedMessage) && loweredMessage.includes("task")) {
    return {
      ...emptyAction("get_tasks_overview"),
      due_date: dueDate,
    };
  }

  const addNoteMatch = trimmedMessage.match(
    /^(?:add|update)\s+notes?\s+to\s+(.+?)(?:\s+task)?(?:\s*:\s*|\s+notes?\s+|\s+details?\s+)(.+)$/i,
  );

  if (addNoteMatch) {
    return {
      ...emptyAction("add_update_notes"),
      target_task_query: cleanTaskTitle(addNoteMatch[1]),
      notes: addNoteMatch[2].trim(),
      time_text: timeText,
    };
  }

  const renameMatch = trimmedMessage.match(
    /^(?:rename|change)\s+(.+?)(?:\s+task)?\s+(?:to|as)\s+(.+)$/i,
  );

  if (renameMatch) {
    return {
      ...emptyAction("rename_task"),
      target_task_query: cleanTaskTitle(renameMatch[1]),
      new_title: toSentenceCase(cleanTaskTitle(renameMatch[2])),
    };
  }

  const moveMatch = trimmedMessage.match(
    /^(?:move|reschedule|shift)\s+(.+?)(?:\s+task)?\s+(?:to|for|on)\s+(.+)$/i,
  );

  if (moveMatch) {
    return {
      ...emptyAction("update_due_date"),
      target_task_query: cleanTaskTitle(moveMatch[1]),
      due_date: normalizeDueDate(moveMatch[2], trimmedMessage),
      time_text: timeText,
    };
  }

  const deleteMatch = trimmedMessage.match(/^(?:delete|remove|cancel)\s+(?:the\s+)?(.+?)(?:\s+task)?$/i);

  if (deleteMatch) {
    return {
      ...emptyAction("delete_task"),
      target_task_query: cleanTaskTitle(deleteMatch[1]),
    };
  }

  const completeMatch = trimmedMessage.match(
    /^(?:mark\s+)?(.+?)(?:\s+task)?\s+(?:as\s+)?(?:complete|completed|done)$/i,
  );

  if (completeMatch || loweredMessage.startsWith("complete ")) {
    return {
      ...emptyAction("complete_task"),
      target_task_query: cleanTaskTitle(
        completeMatch?.[1] ?? trimmedMessage.replace(/^complete\s+/i, ""),
      ),
    };
  }

  const reopenMatch = trimmedMessage.match(
    /^(?:reopen|mark)\s+(.+?)(?:\s+task)?(?:\s+(?:as\s+)?(?:pending|open|incomplete))?$/i,
  );

  if (reopenMatch && (loweredMessage.includes("reopen") || loweredMessage.includes("pending"))) {
    return {
      ...emptyAction("reopen_task"),
      target_task_query: cleanTaskTitle(reopenMatch[1]),
    };
  }

  const createMatch = trimmedMessage.match(
    /^(?:add\s+(?:a\s+)?task|create\s+(?:a\s+)?task|remind\s+me\s+to|remind)\s+(.+)$/i,
  );

  if (createMatch) {
    return {
      ...emptyAction("create_task"),
      title: toSentenceCase(cleanTaskTitle(createMatch[1])),
      due_date: dueDate,
      time_text: timeText,
    };
  }

  if (dueDate && !isQuestionLikeMessage(trimmedMessage)) {
    return {
      ...emptyAction("create_task"),
      title: toSentenceCase(cleanTaskTitle(trimmedMessage)),
      due_date: dueDate,
      time_text: timeText,
    };
  }

  return null;
}

function emptyAction(intent: AssistantIntent): AssistantAction {
  return {
    intent,
    title: null,
    target_task_query: null,
    new_title: null,
    notes: null,
    due_date: null,
    time_text: null,
    note_title: null,
    note_content: null,
    assistant_reply: null,
  };
}

function normalizeAction(action: AssistantAction, message: string): AssistantAction {
  const timeText = extractTimeText(message, action.time_text);
  const dueDate = normalizeDueDate(action.due_date, message);

  return {
    ...action,
    title: action.title ? toSentenceCase(cleanTaskTitle(action.title)) : null,
    target_task_query: action.target_task_query ? cleanTaskTitle(action.target_task_query) : null,
    new_title: action.new_title ? toSentenceCase(cleanTaskTitle(action.new_title)) : null,
    notes: action.notes?.trim() ?? null,
    due_date: dueDate,
    time_text: timeText,
  };
}

function taskMatchScore(task: TaskRow, query: string) {
  const normalizedTitle = task.title.toLowerCase();
  const normalizedQuery = query.toLowerCase().replace(/\btask\b/g, "").trim();

  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedTitle === normalizedQuery) {
    return 100;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 80;
  }

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  const matchingWords = queryWords.filter((word) => normalizedTitle.includes(word));

  return matchingWords.length > 0 ? Math.round((matchingWords.length / queryWords.length) * 60) : 0;
}

function buildClarificationReply(tasks: TaskRow[]) {
  const matches = tasks
    .slice(0, 5)
    .map((task) => `"${task.title}"`)
    .join(", ");

  return `I found multiple matching tasks: ${matches}. Which one should I update?`;
}

function buildTaskOverviewReply(tasks: Array<{ title: string; due_date: string | null; status: string }>) {
  if (tasks.length === 0) {
    return "I could not find any matching tasks.";
  }

  const preview = tasks
    .slice(0, 5)
    .map((task) => `${task.title}${task.due_date ? ` on ${task.due_date}` : ""}`)
    .join(", ");
  const extraCount = tasks.length - 5;

  return `I found ${tasks.length} matching task${tasks.length === 1 ? "" : "s"}: ${preview}${extraCount > 0 ? `, and ${extraCount} more` : ""}.`;
}

async function parseAssistantAction(client: OpenAI | null, message: string) {
  if (!client) {
    return fallbackAction(message);
  }

  const today = getTodayDate();
  const tomorrow = addDays(today, 1);

  const openaiResponse = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You parse personal assistant messages into one safe action. " +
              `Today is ${today}, tomorrow is ${tomorrow}, and the user's timezone is ${userTimeZone}. ` +
              "Return only structured JSON. Use create_task for adding reminders/tasks. " +
              "Use update_task only for changing multiple task fields at once. " +
              "Use delete_task, complete_task, reopen_task, add_update_notes, update_due_date, or rename_task for specific task changes. " +
              "Use get_tasks_overview for asking about tasks. Use general_answer for normal questions. " +
              "For existing-task actions, put the words that identify the task in target_task_query. " +
              "For rename_task, put the replacement name in new_title. " +
              "For add_update_notes, put only the note text in notes. " +
              "For update_due_date, put the normalized due date in due_date when possible. " +
              "For general_answer, provide a brief answer in assistant_reply. " +
              "If a request is ambiguous, still return the intended action and target_task_query; the backend will ask for clarification.",
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
        name: "assistant_task_action",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            intent: {
              type: "string",
              enum: [
                "create_task",
                "update_task",
                "delete_task",
                "complete_task",
                "reopen_task",
                "add_update_notes",
                "update_due_date",
                "rename_task",
                "create_note",
                "get_dashboard_summary",
                "get_tasks_overview",
                "general_answer",
                "unknown",
              ],
            },
            title: { type: ["string", "null"] },
            target_task_query: { type: ["string", "null"] },
            new_title: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
            due_date: { type: ["string", "null"] },
            time_text: { type: ["string", "null"] },
            note_title: { type: ["string", "null"] },
            note_content: { type: ["string", "null"] },
            assistant_reply: { type: ["string", "null"] },
          },
          required: [
            "intent",
            "title",
            "target_task_query",
            "new_title",
            "notes",
            "due_date",
            "time_text",
            "note_title",
            "note_content",
            "assistant_reply",
          ],
        },
      },
    },
  });

  return JSON.parse(openaiResponse.output_text) as AssistantAction;
}

async function findMatchingTask(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  query: string | null,
) {
  if (!query?.trim()) {
    return {
      task: null,
      assistantReply: "Which task should I update?",
    };
  }

  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, notes, due_date, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return {
      task: null,
      assistantReply: "I could not load your tasks right now.",
      errorDetail: error.message,
    };
  }

  const scoredTasks = ((data as TaskRow[] | null) ?? [])
    .map((task) => ({
      task,
      score: taskMatchScore(task, query),
    }))
    .filter((result) => result.score >= 40)
    .sort((first, second) => second.score - first.score);

  if (scoredTasks.length === 0) {
    return {
      task: null,
      assistantReply: `I could not find a task matching "${query}".`,
    };
  }

  const bestScore = scoredTasks[0].score;
  const bestMatches = scoredTasks.filter((result) => result.score === bestScore);

  if (bestMatches.length > 1) {
    return {
      task: null,
      assistantReply: buildClarificationReply(bestMatches.map((result) => result.task)),
    };
  }

  return {
    task: scoredTasks[0].task,
  };
}

function actionResponse(
  intent: AssistantIntent,
  assistantReply: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({
    success: true,
    intent,
    action: intent,
    assistantReply,
    ...extra,
  });
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
          action: "unknown",
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
          action: "unknown",
          assistantReply: "Please sign in to use the assistant for your own data.",
          errorDetail: "Missing authenticated user.",
        },
        { status: 401 },
      );
    }

    console.log("[assistant] outgoing message:", message);

    let action: AssistantAction;

    try {
      const fastAction = parseFastTaskAction(message);
      action = normalizeAction(
        fastAction ?? (await parseAssistantAction(client, message)),
        message,
      );
    } catch (openaiError) {
      console.error("[assistant] action parse failed, using fallback:", openaiError);
      action = normalizeAction(fallbackAction(message), message);
    }

    console.log("[assistant] interpreted action:", action);

    if (action.intent === "create_task") {
      const title = action.title?.trim();

      if (!title) {
        return actionResponse("create_task", "What should I call the task?");
      }

      const notes = mergeTaskNotes(action.notes ?? "", action.time_text);
      const status: TaskStatus = isToday(action.due_date) ? "today" : "pending";
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          title,
          notes,
          status,
          due_date: action.due_date,
        })
        .select("id, title, status, notes, created_at, due_date")
        .single();

      console.log("[assistant] supabase create task result:", { data, error });

      if (error) {
        return NextResponse.json(
          {
            success: false,
            intent: action.intent,
            action: action.intent,
            assistantReply: "Could not create task.",
            errorDetail: error.message,
          },
          { status: 500 },
        );
      }

      return actionResponse(
        action.intent,
        notes ? "Done - I added that task with notes." : "Done - I added that task.",
        { createdTask: data },
      );
    }

    if (
      action.intent === "update_task" ||
      action.intent === "delete_task" ||
      action.intent === "complete_task" ||
      action.intent === "reopen_task" ||
      action.intent === "add_update_notes" ||
      action.intent === "update_due_date" ||
      action.intent === "rename_task"
    ) {
      const match = await findMatchingTask(supabase, action.target_task_query);

      if (!match.task) {
        return NextResponse.json(
          {
            success: Boolean(!match.errorDetail),
            intent: action.intent,
            action: action.intent,
            assistantReply: match.assistantReply,
            errorDetail: match.errorDetail,
          },
          { status: match.errorDetail ? 500 : 200 },
        );
      }

      if (action.intent === "delete_task") {
        const { error } = await supabase.from("tasks").delete().eq("id", match.task.id);

        console.log("[assistant] supabase delete task result:", { id: match.task.id, error });

        if (error) {
          return NextResponse.json(
            {
              success: false,
              intent: action.intent,
              action: action.intent,
              assistantReply: "Could not delete that task.",
              errorDetail: error.message,
            },
            { status: 500 },
          );
        }

        return actionResponse(action.intent, `Done - I deleted "${match.task.title}".`, {
          deletedTask: match.task,
        });
      }

      const updates: Partial<Pick<TaskRow, "title" | "status" | "notes" | "due_date">> = {};

      if (action.intent === "complete_task") {
        updates.status = "completed";
      }

      if (action.intent === "reopen_task") {
        updates.status = isToday(match.task.due_date) ? "today" : "pending";
      }

      if (action.intent === "rename_task" || action.intent === "update_task") {
        if (action.new_title) {
          updates.title = action.new_title;
        }
      }

      if (action.intent === "add_update_notes" || action.intent === "update_task") {
        if (action.notes) {
          updates.notes = appendTaskNotes(match.task.notes ?? "", mergeTaskNotes(action.notes, action.time_text));
        }
      }

      if (action.intent === "update_due_date" || action.intent === "update_task") {
        if (action.due_date) {
          updates.due_date = action.due_date;
          updates.status = isToday(action.due_date) ? "today" : match.task.status === "completed" ? "completed" : "pending";
        }
      }

      if (Object.keys(updates).length === 0) {
        return actionResponse(action.intent, "I found the task, but I need the new detail to update.");
      }

      const { data, error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", match.task.id)
        .select("id, title, status, notes, created_at, due_date")
        .single();

      console.log("[assistant] supabase update task result:", {
        id: match.task.id,
        updates,
        data,
        error,
      });

      if (error) {
        return NextResponse.json(
          {
            success: false,
            intent: action.intent,
            action: action.intent,
            assistantReply: "Could not update that task.",
            errorDetail: error.message,
          },
          { status: 500 },
        );
      }

      const replyByIntent: Record<string, string> = {
        update_task: `Done - I updated "${data.title}".`,
        complete_task: `Done - I marked "${data.title}" complete.`,
        reopen_task: `Done - I moved "${data.title}" back to pending.`,
        add_update_notes: `Done - I updated the notes for "${data.title}".`,
        update_due_date: `Done - I moved "${data.title}" to ${data.due_date}.`,
        rename_task: `Done - I renamed the task to "${data.title}".`,
      };

      return actionResponse(action.intent, replyByIntent[action.intent], {
        updatedTask: data,
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

      console.log("[assistant] supabase create note result:", { data, error });

      if (error) {
        return NextResponse.json(
          {
            success: false,
            intent: action.intent,
            action: action.intent,
            assistantReply: "Could not create note.",
            errorDetail: error.message,
          },
          { status: 500 },
        );
      }

      return actionResponse(action.intent, "Done - I saved that note.", { createdNote: data });
    }

    if (action.intent === "get_dashboard_summary") {
      const [pendingResult, todayResult] = await Promise.all([
        supabase.from("tasks").select("id, due_date").eq("status", "pending"),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "today"),
      ]);

      if (pendingResult.error || todayResult.error) {
        return NextResponse.json(
          {
            success: false,
            intent: action.intent,
            action: action.intent,
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

      return actionResponse(
        action.intent,
        `You have ${pendingCount} pending tasks, ${todayResult.count ?? 0} task due today, and ${upcomingCount} upcoming task${upcomingCount === 1 ? "" : "s"}.`,
      );
    }

    if (action.intent === "get_tasks_overview") {
      let query = supabase
        .from("tasks")
        .select("title, due_date, status")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      const loweredMessage = message.toLowerCase();

      if (action.due_date) {
        query = query.eq("due_date", action.due_date);
      } else if (loweredMessage.includes("completed")) {
        query = query.eq("status", "completed");
      } else if (loweredMessage.includes("upcoming")) {
        query = query.eq("status", "pending").gte("due_date", getTodayDate());
      } else if (loweredMessage.includes("pending")) {
        query = query.eq("status", "pending");
      } else if (loweredMessage.includes("today")) {
        query = query.in("status", ["today", "pending"]).eq("due_date", getTodayDate());
      } else {
        query = query.neq("status", "completed");
      }

      const { data, error } = await query.limit(10);

      if (error) {
        return NextResponse.json(
          {
            success: false,
            intent: action.intent,
            action: action.intent,
            assistantReply: "Could not load matching tasks right now.",
            errorDetail: error.message,
          },
          { status: 500 },
        );
      }

      return actionResponse(action.intent, buildTaskOverviewReply(data ?? []));
    }

    return actionResponse(
      action.intent === "unknown" ? "general_answer" : action.intent,
      action.assistant_reply ||
        "I can answer questions and manage tasks. Try asking me to add, rename, complete, reopen, move, delete, or add notes to a task.",
    );
  } catch (error) {
    console.error("[assistant] route error:", error);

    return NextResponse.json(
      {
        success: false,
        intent: "unknown",
        action: "unknown",
        assistantReply: "The assistant route failed while processing your message.",
        errorDetail: error instanceof Error ? error.message : "Unknown route error.",
      },
      { status: 500 },
    );
  }
}
