"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type PageName = "Dashboard" | "Tasks" | "Notes" | "Assistant" | "Settings";
type TaskStatus = "today" | "pending" | "completed";
type AssistantMode = "Chat Mode" | "Mic Mode" | "Talk Mode";

type Task = {
  id: number;
  title: string;
  status: TaskStatus;
  notes: string;
  created_at: string;
  due_date: string | null;
};

type Note = {
  id: number;
  title: string;
  content: string;
  created_at: string;
};

type Message = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

type SpeechRecognitionResultLike = {
  0: {
    transcript: string;
  };
  isFinal: boolean;
  length: number;
};

type SpeechRecognitionEventLike = Event & {
  results: {
    [index: number]: SpeechRecognitionResultLike;
    length: number;
  };
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const sidebarItems: PageName[] = [
  "Dashboard",
  "Tasks",
  "Notes",
  "Assistant",
  "Settings",
];

const initialMessages: Message[] = [
  { id: 1, role: "assistant", text: "Hello! What would you like help with today?" },
  { id: 2, role: "user", text: "Help me organize my afternoon." },
  { id: 3, role: "assistant", text: "Got it" },
];

function formatCreatedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatUpcomingTaskDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function isTodayDate(value: string | null) {
  if (!value) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  date.setHours(0, 0, 0, 0);
  return date.getTime() === today.getTime();
}

function isFutureDate(value: string | null) {
  if (!value) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  date.setHours(0, 0, 0, 0);
  return date.getTime() > today.getTime();
}

type AssistantApiResponse = {
  success: boolean;
  intent:
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
  assistantReply: string;
  createdTask?: Task;
  updatedTask?: Task;
  deletedTask?: Task;
  createdNote?: Note;
  errorDetail?: string;
};

type AssistantActivity = {
  id: number;
  label: string;
  detail: string;
  created_at: string;
};

type IntegrationStatus = {
  name: "Google Calendar" | "Email" | "WhatsApp";
  configured: boolean;
  summary: string;
  missingKeys: string[];
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function normalizeTask(task: Partial<Task> & { id: number; title: string; status: TaskStatus }) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    notes: task.notes ?? "",
    created_at: task.created_at ?? new Date().toISOString(),
    due_date: task.due_date ?? null,
  };
}

export default function Home() {
  const [activePage, setActivePage] = useState<PageName>("Dashboard");
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskNotes, setNewTaskNotes] = useState("");
  const [newTaskStatus, setNewTaskStatus] = useState<"today" | "pending">("pending");
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("Chat Mode");
  const [assistantActivities, setAssistantActivities] = useState<AssistantActivity[]>([]);
  const [assistantError, setAssistantError] = useState("");
  const [assistantDebugInfo, setAssistantDebugInfo] = useState("");
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationStatus[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationsError, setIntegrationsError] = useState("");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [chatInput, setChatInput] = useState("");
  const [microphoneStatus, setMicrophoneStatus] = useState("Microphone not connected.");
  const [micTranscript, setMicTranscript] = useState("");
  const [isMicListening, setIsMicListening] = useState(false);
  const [talkStatus, setTalkStatus] = useState("Push and hold to talk.");
  const [talkTranscript, setTalkTranscript] = useState("");
  const [talkReply, setTalkReply] = useState("");
  const [isPushToTalkActive, setIsPushToTalkActive] = useState(false);
  const assistantSectionRef = useRef<HTMLDivElement | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const micTranscriptRef = useRef("");
  const talkTranscriptRef = useRef("");
  const currentUser: User | null = session?.user ?? null;

  const selectedNote =
    notes.find((note) => note.id === selectedNoteId) ?? notes[0] ?? null;

  const todayTasks = tasks.filter(
    (task) => task.status === "today" || (task.status === "pending" && isTodayDate(task.due_date)),
  );
  const upcomingTasks = tasks
    .filter((task) => task.status !== "completed" && isFutureDate(task.due_date))
    .sort(
      (firstTask, secondTask) =>
        new Date(firstTask.due_date ?? firstTask.created_at).getTime() -
        new Date(secondTask.due_date ?? secondTask.created_at).getTime(),
    );
  const pendingTasks = tasks.filter(
    (task) =>
      task.status === "pending" &&
      !isTodayDate(task.due_date) &&
      !isFutureDate(task.due_date),
  );
  const completedTasks = tasks.filter((task) => task.status === "completed");

  async function refreshDashboardData() {
    if (!currentUser) {
      setTasks([]);
      setNotes([]);
      setTasksLoading(false);
      setNotesLoading(false);
      return;
    }

    await Promise.resolve();
    console.log("[assistant] refreshing dashboard data");
    setTasksLoading(true);
    setNotesLoading(true);
    setTasksError("");
    setNotesError("");

    const [tasksResult, notesResult] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, status, notes, created_at, due_date")
        .order("created_at", {
          ascending: false,
        }),
      supabase
        .from("notes")
        .select("id, title, content, created_at")
        .order("created_at", { ascending: false }),
    ]);

    console.log("[assistant] dashboard refresh result:", {
      tasksError: tasksResult.error,
      notesError: notesResult.error,
      tasksCount: tasksResult.data?.length ?? 0,
      notesCount: notesResult.data?.length ?? 0,
    });

    if (tasksResult.error) {
      setTasksError("Could not load tasks from Supabase.");
    } else {
      setTasks(
        ((tasksResult.data as Task[] | null) ?? []).map((task) =>
          normalizeTask(task),
        ),
      );
    }

    if (notesResult.error) {
      setNotesError("Could not load notes from Supabase.");
    } else {
      setNotes((notesResult.data as Note[]) ?? []);
    }

    setTasksLoading(false);
    setNotesLoading(false);
  }

  async function loadIntegrationStatuses() {
    setIntegrationsLoading(true);
    setIntegrationsError("");

    try {
      const response = await fetch("/api/integrations/status");
      const result = (await response.json()) as {
        success: boolean;
        integrations?: IntegrationStatus[];
      };

      if (!response.ok || !result.success) {
        setIntegrationsError("Could not load integration status.");
        return;
      }

      setIntegrationStatuses(result.integrations ?? []);
    } catch (error) {
      console.error("[integrations] status load failed:", error);
      setIntegrationsError("Could not load integration status.");
    } finally {
      setIntegrationsLoading(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) {
        return;
      }

      setSession(data.session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    const timeoutId = window.setTimeout(() => {
      void loadIntegrationStatuses();
    }, 0);

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    void refreshDashboardData();
    // refreshDashboardData intentionally reads current auth/session state
    // and reruns only when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  useEffect(() => {
    return () => {
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      speechRecognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  function handlePageChange(page: PageName) {
    setActivePage(page);
    setIsMobileNavOpen(false);
  }

  function addAssistantActivity(label: string, detail: string) {
    const nextActivity: AssistantActivity = {
      id: Date.now(),
      label,
      detail,
      created_at: new Date().toISOString(),
    };

    setAssistantActivities((currentActivities) =>
      [nextActivity, ...currentActivities].slice(0, 6),
    );
  }

  function openAssistant() {
    if (activePage !== "Assistant") {
      setActivePage("Assistant");
      setIsMobileNavOpen(false);

      requestAnimationFrame(() => {
        assistantSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });

      return;
    }

    assistantSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  async function ensureMicrophoneAccess() {
    if (microphoneStreamRef.current) {
      setMicrophoneStatus("Microphone ready for audio features.");
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneStatus("This browser does not support microphone access.");
      return false;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      microphoneStreamRef.current = mediaStream;
      setMicrophoneStatus("Microphone connected and ready.");
      return true;
    } catch {
      setMicrophoneStatus("Microphone permission was denied or unavailable.");
      return false;
    }
  }

  async function handleEnableMicrophone() {
    await ensureMicrophoneAccess();
  }

  function speakAssistantReply(text: string) {
    if (!window.speechSynthesis) {
      setTalkStatus("Speech playback is not available in this browser.");
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.onstart = () => {
      setTalkStatus("Speaking assistant response aloud...");
    };
    utterance.onend = () => {
      setTalkStatus("Done speaking. Press again to talk.");
    };
    utterance.onerror = () => {
      setTalkStatus("I captured your request, but text-to-speech failed.");
    };

    window.speechSynthesis.speak(utterance);
  }

  async function startSpeechRecognition(options: {
    onStart: () => void;
    onTranscript: (transcript: string) => void;
    onComplete: (transcript: string) => Promise<void> | void;
    onUnsupported: () => void;
    onError: (message: string) => void;
    onEmpty: () => void;
  }) {
    const hasMicrophone = await ensureMicrophoneAccess();

    if (!hasMicrophone) {
      return;
    }

    const SpeechRecognitionClass =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      options.onUnsupported();
      return;
    }

    speechRecognitionRef.current?.stop();

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let latestTranscript = "";
    options.onStart();

    recognition.onresult = (event) => {
      let transcript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }

      latestTranscript = transcript.trim();
      options.onTranscript(latestTranscript);
    };

    recognition.onerror = (event) => {
      options.onError(
        event.error === "not-allowed"
          ? "Speech recognition permission was denied."
          : "Speech recognition ran into a problem. Please try again.",
      );
    };

    recognition.onend = async () => {
      if (!latestTranscript.trim()) {
        options.onEmpty();
        return;
      }

      await options.onComplete(latestTranscript.trim());
    };

    speechRecognitionRef.current = recognition;
    recognition.start();
  }

  async function handleMicModeStart() {
    await startSpeechRecognition({
      onStart: () => {
        setMicTranscript("");
        micTranscriptRef.current = "";
        setIsMicListening(true);
        setMicrophoneStatus("Listening... speak now.");
      },
      onTranscript: (transcript) => {
        setMicTranscript(transcript);
        micTranscriptRef.current = transcript;
      },
      onComplete: async (transcript) => {
        setIsMicListening(false);
        setMicrophoneStatus("Transcript captured. Sending to the assistant...");
        const assistantReply = await sendAssistantMessage(transcript);
        setMicrophoneStatus(
          assistantReply
            ? `Done. ${assistantReply}`
            : "I could not process your speech right now.",
        );
      },
      onUnsupported: () => {
        setMicrophoneStatus(
          "Speech recognition is not available in this browser yet. You can still use Chat Mode.",
        );
      },
      onError: (message) => {
        setIsMicListening(false);
        setMicrophoneStatus(message);
      },
      onEmpty: () => {
        setIsMicListening(false);
        setMicrophoneStatus("I did not catch anything. Please try speaking again.");
      },
    });
  }

  async function handlePushToTalkStart() {
    await startSpeechRecognition({
      onStart: () => {
        setTalkTranscript("");
        talkTranscriptRef.current = "";
        setTalkReply("");
        setIsPushToTalkActive(true);
        setTalkStatus("Listening... speak now.");
      },
      onTranscript: (transcript) => {
        setTalkTranscript(transcript);
        talkTranscriptRef.current = transcript;
      },
      onComplete: async (transcript) => {
        setIsPushToTalkActive(false);
        setTalkStatus("Transcript captured. Sending to the assistant...");
        const assistantReply = await sendAssistantMessage(transcript);

        if (!assistantReply) {
          setTalkStatus("I captured your voice, but no assistant reply came back.");
          return;
        }

        setTalkReply(assistantReply);

        if (!window.speechSynthesis) {
          setTalkStatus(
            "Speech recognition worked, but spoken replies are not available in this browser.",
          );
          return;
        }

        speakAssistantReply(assistantReply);
      },
      onUnsupported: () => {
        setIsPushToTalkActive(false);
        setTalkStatus(
          "Speech recognition is not available in this browser. You can still use Chat Mode.",
        );
      },
      onError: (message) => {
        setIsPushToTalkActive(false);
        setTalkStatus(message);
      },
      onEmpty: () => {
        setIsPushToTalkActive(false);
        setTalkStatus("I did not catch anything. Please press and try again.");
      },
    });
  }

  function handlePushToTalkEnd() {
    speechRecognitionRef.current?.stop();
  }

  async function createTaskRecord(
    title: string,
    status: "today" | "pending",
    notes = "",
    dueDate: string | null = null,
  ) {
    const trimmedTitle = title.trim();

    if (!currentUser) {
      return { task: null, errorMessage: "Please sign in to create tasks." };
    }

    if (!trimmedTitle) {
      return { task: null, errorMessage: "Task title cannot be empty." };
    }

    setTasksError("");

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: currentUser?.id,
        title: trimmedTitle,
        status,
        notes,
        due_date: dueDate,
      })
      .select("id, title, status, notes, created_at, due_date")
      .single();

    if (error) {
      setTasksError("Could not add task.");
      return { task: null, errorMessage: "Could not add task." };
    }

    const createdTask = normalizeTask(data as Task);
    setTasks((currentTasks) => [createdTask, ...currentTasks]);

    return { task: createdTask, errorMessage: null };
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const { task } = await createTaskRecord(
      newTaskTitle,
      newTaskStatus,
      newTaskNotes,
    );

    if (!task) {
      return;
    }

    setNewTaskTitle("");
    setNewTaskNotes("");
    setNewTaskStatus("pending");
  }

  async function updateTaskStatus(taskId: number) {
    const existingTask = tasks.find((task) => task.id === taskId);

    if (!existingTask) {
      return;
    }

    const nextStatus: TaskStatus =
      existingTask.status === "completed" ? "pending" : "completed";

    setTasksError("");

    const { error } = await supabase
      .from("tasks")
      .update({ status: nextStatus })
      .eq("id", taskId);

    if (error) {
      setTasksError("Could not update task.");
      return;
    }

    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === taskId ? { ...task, status: nextStatus } : task,
      ),
    );
  }

  async function removeTask(taskId: number) {
    setTasksError("");

    const { error } = await supabase.from("tasks").delete().eq("id", taskId);

    if (error) {
      setTasksError("Could not delete task.");
      return;
    }

    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId));
  }

  async function updateTaskNotes(taskId: number, nextNotes: string) {
    setTasksError("");

    const { error } = await supabase
      .from("tasks")
      .update({ notes: nextNotes })
      .eq("id", taskId);

    if (error) {
      setTasksError("Could not save task details.");
      return;
    }

    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === taskId ? { ...task, notes: nextNotes } : task,
      ),
    );
  }

  async function createNote() {
    if (!currentUser) {
      setNotesError("Please sign in to create notes.");
      return;
    }

    setNotesError("");

    const createdAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("notes")
      .insert({
        user_id: currentUser?.id,
        title: "",
        content: "",
        created_at: createdAt,
      })
      .select("id, title, content, created_at")
      .single();

    if (error) {
      setNotesError("Could not create note.");
      return;
    }

    const newNote = data as Note;
    setNotes((currentNotes) => [newNote, ...currentNotes]);
    setSelectedNoteId(newNote.id);
  }

  async function updateSelectedNoteTitle(title: string) {
    const currentNoteId = selectedNote?.id ?? null;

    if (currentNoteId === null) {
      return;
    }

    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === currentNoteId ? { ...note, title } : note,
      ),
    );
    setNotesError("");

    const { error } = await supabase
      .from("notes")
      .update({ title })
      .eq("id", currentNoteId);

    if (error) {
      setNotesError("Could not save note title.");
    }
  }

  async function updateSelectedNoteContent(content: string) {
    const currentNoteId = selectedNote?.id ?? null;

    if (currentNoteId === null) {
      return;
    }

    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === currentNoteId ? { ...note, content } : note,
      ),
    );
    setNotesError("");

    const { error } = await supabase
      .from("notes")
      .update({ content })
      .eq("id", currentNoteId);

    if (error) {
      setNotesError("Could not save note content.");
    }
  }

  async function deleteNote(noteId: number) {
    setNotesError("");

    const { error } = await supabase.from("notes").delete().eq("id", noteId);

    if (error) {
      setNotesError("Could not delete note.");
      return;
    }

    setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId));
  }

  async function sendAssistantMessage(messageText: string) {
    const trimmedMessage = messageText.trim();

    if (!trimmedMessage) {
      return null;
    }

    const userMessage: Message = {
      id: Date.now(),
      role: "user",
      text: trimmedMessage,
    };
    let assistantReplyText =
      "I understood your message, but I could not complete that action right now.";
    setAssistantError("");
    setAssistantDebugInfo("");

    try {
      console.log("[assistant] outgoing assistant message:", trimmedMessage);
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? {
                Authorization: `Bearer ${session.access_token}`,
              }
            : {}),
        },
        body: JSON.stringify({
          message: trimmedMessage,
        }),
      });

      const result = (await response.json()) as AssistantApiResponse;
      console.log("[assistant] assistant route response:", result);

      if (!response.ok) {
        assistantReplyText = result.assistantReply ?? assistantReplyText;
        setAssistantError(assistantReplyText);
        setAssistantDebugInfo(
          result.errorDetail ?? `Assistant route returned HTTP ${response.status}.`,
        );
      } else {
        assistantReplyText = result.assistantReply;
        setAssistantDebugInfo("");

        if (result.createdTask) {
          addAssistantActivity("Task Created", result.createdTask.title);
        }

        if (result.updatedTask) {
          addAssistantActivity("Task Updated", result.updatedTask.title);
        }

        if (result.deletedTask) {
          addAssistantActivity("Task Deleted", result.deletedTask.title);
        }

        if (result.createdNote) {
          addAssistantActivity(
            "Note Saved",
            result.createdNote.title.trim() || "Untitled Note",
          );
        }

        if (result.intent === "get_dashboard_summary") {
          addAssistantActivity("Dashboard Summary", result.assistantReply);
        }

        await refreshDashboardData();
      }
    } catch (error) {
      console.error("[assistant] fetch/API error:", error);
      assistantReplyText = "I could not reach the assistant route right now.";
      setAssistantError(assistantReplyText);
      setAssistantDebugInfo(
        error instanceof Error ? error.message : "Unknown fetch error.",
      );
    }

    const assistantReply: Message = {
      id: Date.now() + 1,
      role: "assistant",
      text: assistantReplyText,
    };

    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      assistantReply,
    ]);

    return assistantReplyText;
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = chatInput.trim();

    if (!trimmedMessage) {
      return;
    }

    await sendAssistantMessage(trimmedMessage);
    setChatInput("");
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");

    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Email and password are required.");
      return;
    }

    const authAction =
      authMode === "sign_in"
        ? supabase.auth.signInWithPassword({
            email: authEmail.trim(),
            password: authPassword,
          })
        : supabase.auth.signUp({
            email: authEmail.trim(),
            password: authPassword,
          });

    const { error } = await authAction;

    if (error) {
      setAuthError(error.message);
      return;
    }

    if (authMode === "sign_up") {
      setAuthError("Account created. If email confirmation is enabled, confirm it and then sign in.");
      setAuthMode("sign_in");
      setAuthPassword("");
      return;
    }

    setAuthEmail("");
    setAuthPassword("");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setTasks([]);
    setNotes([]);
    setMessages(initialMessages);
    setAssistantActivities([]);
    setActivePage("Dashboard");
  }

  const assistantPanel = (
    <div ref={assistantSectionRef}>
      <AssistantView
        mode={assistantMode}
        onModeChange={setAssistantMode}
        messages={messages}
        chatInput={chatInput}
        onChatInputChange={setChatInput}
        onChatSubmit={handleChatSubmit}
        assistantError={assistantError}
        assistantDebugInfo={assistantDebugInfo}
        microphoneStatus={microphoneStatus}
        micTranscript={micTranscript}
        isMicListening={isMicListening}
        talkStatus={talkStatus}
        talkTranscript={talkTranscript}
        talkReply={talkReply}
        isPushToTalkActive={isPushToTalkActive}
        onEnableMicrophone={handleEnableMicrophone}
        onStartMicListening={handleMicModeStart}
        onPushToTalkStart={handlePushToTalkStart}
        onPushToTalkEnd={handlePushToTalkEnd}
      />
    </div>
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.08),_transparent_35%),linear-gradient(180deg,#f8fbff_0%,#eef4fb_100%)] p-2 sm:p-6">
      <div className="mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-[22px] border border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:min-h-[calc(100vh-2rem)] sm:rounded-[28px] lg:min-h-[860px] lg:flex-row lg:rounded-[32px]">
        <aside className="hidden w-full flex-col border-b border-slate-200/80 bg-slate-950 px-5 py-6 text-slate-100 lg:flex lg:max-w-72 lg:border-r lg:border-b-0">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-400">
              Personal Assistant
            </p>
            <h1 className="mt-3 text-2xl font-semibold">Your day, in one place</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              A calm dashboard for tasks, notes, and assistant tools.
            </p>
          </div>

          <nav className="flex flex-col gap-2">
            {sidebarItems.map((item) => {
              const isActive = item === activePage;

              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => handlePageChange(item)}
                  className={`rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                    isActive
                      ? "bg-white text-slate-950 shadow-lg"
                      : "text-slate-300 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
              Daily focus
            </p>
            <p className="mt-3 text-lg font-semibold">Stay on top of what matters</p>
            <p className="mt-2 text-sm text-slate-400">
              Use the dashboard for a quick snapshot, then jump into tasks, notes,
              or assistant modes.
            </p>
          </div>
        </aside>

        <section className="min-w-0 flex-1 bg-slate-50/70 p-2 sm:p-5 lg:p-8">
          <div className="mb-3 rounded-[22px] border border-slate-200 bg-slate-950 px-4 py-4 text-slate-100 shadow-sm sm:mb-5 sm:rounded-[28px] lg:hidden">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                  Personal Assistant
                </p>
                <h1 className="mt-2 truncate text-lg font-semibold">{activePage}</h1>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileNavOpen((current) => !current)}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
              >
                {isMobileNavOpen ? "Close" : "Menu"}
              </button>
            </div>

            {isMobileNavOpen && (
              <nav className="mt-4 grid gap-2 border-t border-white/10 pt-4">
                {sidebarItems.map((item) => {
                  const isActive = item === activePage;

                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handlePageChange(item)}
                      className={`rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                        isActive
                          ? "bg-white text-slate-950"
                          : "bg-white/5 text-slate-200 hover:bg-white/10"
                      }`}
                    >
                      {item}
                    </button>
                  );
                })}
              </nav>
            )}
          </div>

          {currentUser && activePage === "Dashboard" && (
            <div className="mb-4 lg:hidden">{assistantPanel}</div>
          )}

          <div className="mb-4 flex flex-col gap-4 border-b border-slate-200 pb-4 sm:mb-8 sm:pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-500">
                Workspace
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">
                {activePage}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                A test-mode personal assistant workspace with sign-in, shared AI actions,
                and user-specific tasks and notes.
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
              <div className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm sm:w-auto">
                {currentUser?.email ?? "Testing mode"}
              </div>
              {currentUser && (
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300"
                >
                  Sign Out
                </button>
              )}
            </div>
          </div>

          {authLoading && (
            <EmptyState
              title="Loading account"
              description="Checking your session and preparing your workspace."
            />
          )}

          {!authLoading && !currentUser && (
            <AuthView
              authMode={authMode}
              authEmail={authEmail}
              authPassword={authPassword}
              authError={authError}
              onAuthModeChange={setAuthMode}
              onAuthEmailChange={setAuthEmail}
              onAuthPasswordChange={setAuthPassword}
              onSubmit={handleAuthSubmit}
            />
          )}

          {currentUser && activePage === "Dashboard" && (
            <div className="space-y-5 md:space-y-6">
              <div className="hidden lg:block">{assistantPanel}</div>
              <DashboardView
                todayTasks={todayTasks}
                upcomingTasks={upcomingTasks}
                pendingTasks={pendingTasks}
                completedTasks={completedTasks}
                notes={notes}
                assistantActivities={assistantActivities}
              />
            </div>
          )}

          {currentUser && activePage === "Tasks" && (
            <TasksView
              todayTasks={todayTasks}
              upcomingTasks={upcomingTasks}
              pendingTasks={pendingTasks}
              completedTasks={completedTasks}
              tasksLoading={tasksLoading}
              tasksError={tasksError}
              newTaskTitle={newTaskTitle}
              newTaskNotes={newTaskNotes}
              newTaskStatus={newTaskStatus}
              onNewTaskTitleChange={setNewTaskTitle}
              onNewTaskNotesChange={setNewTaskNotes}
              onNewTaskStatusChange={setNewTaskStatus}
              onAddTask={addTask}
              onCompleteTask={updateTaskStatus}
              onSaveTaskNotes={updateTaskNotes}
              onDeleteTask={removeTask}
            />
          )}

          {currentUser && activePage === "Notes" && (
            <NotesView
              notes={notes}
              selectedNote={selectedNote}
              notesLoading={notesLoading}
              notesError={notesError}
              onSelectNote={(noteId) => setSelectedNoteId(noteId)}
              onCreateNote={createNote}
              onChangeNoteTitle={updateSelectedNoteTitle}
              onChangeNoteContent={updateSelectedNoteContent}
              onDeleteNote={deleteNote}
            />
          )}

          {currentUser && activePage === "Assistant" && (
            assistantPanel
          )}

          {currentUser && activePage === "Settings" && (
            <SettingsView
              integrationStatuses={integrationStatuses}
              integrationsLoading={integrationsLoading}
              integrationsError={integrationsError}
            />
          )}
        </section>
      </div>

      <button
        type="button"
        onClick={openAssistant}
        aria-label="Open Assistant"
        className="fixed bottom-4 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full border border-white/80 bg-slate-950 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 sm:bottom-6 sm:right-6 sm:h-16 sm:w-16"
      >
        <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.24),_transparent_55%)]" />
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-xs uppercase tracking-[0.2em] sm:h-11 sm:w-11">
          AI
        </span>
      </button>
    </main>
  );
}

function DashboardView({
  todayTasks,
  upcomingTasks,
  pendingTasks,
  completedTasks,
  notes,
  assistantActivities,
}: {
  todayTasks: Task[];
  upcomingTasks: Task[];
  pendingTasks: Task[];
  completedTasks: Task[];
  notes: Note[];
  assistantActivities: AssistantActivity[];
}) {
  return (
    <div className="grid gap-4 md:gap-5 lg:grid-cols-3">
      <StatCard title="Tasks for Today" value={todayTasks.length.toString()} detail="Items scheduled for today" />
      <StatCard title="Pending Tasks" value={pendingTasks.length.toString()} detail="Still waiting for action" />
      <StatCard title="Completed Tasks" value={completedTasks.length.toString()} detail="Finished and cleared" />

      <SectionCard title="Tasks for Today" className="md:col-span-2 lg:col-span-2">
        <TaskPreviewList tasks={todayTasks} emptyMessage="No tasks scheduled for today." />
      </SectionCard>

      <SectionCard title="Upcoming Tasks" className="lg:col-span-2">
        <UpcomingTasksList tasks={upcomingTasks} />
      </SectionCard>

      <SectionCard title="Quick Notes">
        <div className="space-y-3">
          {notes.slice(0, 2).map((note) => (
            <div key={note.id} className="rounded-2xl bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">
                {note.title.trim() || "Untitled Note"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{note.content}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Assistant Activity" className="lg:col-span-2">
        <AssistantActivityList activities={assistantActivities} />
      </SectionCard>
    </div>
  );
}

function TasksView({
  todayTasks,
  upcomingTasks,
  pendingTasks,
  completedTasks,
  tasksLoading,
  tasksError,
  newTaskTitle,
  newTaskNotes,
  newTaskStatus,
  onNewTaskTitleChange,
  onNewTaskNotesChange,
  onNewTaskStatusChange,
  onAddTask,
  onCompleteTask,
  onSaveTaskNotes,
  onDeleteTask,
}: {
  todayTasks: Task[];
  upcomingTasks: Task[];
  pendingTasks: Task[];
  completedTasks: Task[];
  tasksLoading: boolean;
  tasksError: string;
  newTaskTitle: string;
  newTaskNotes: string;
  newTaskStatus: "today" | "pending";
  onNewTaskTitleChange: (value: string) => void;
  onNewTaskNotesChange: (value: string) => void;
  onNewTaskStatusChange: (value: "today" | "pending") => void;
  onAddTask: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onCompleteTask: (taskId: number) => Promise<void> | void;
  onSaveTaskNotes: (taskId: number, nextNotes: string) => Promise<void> | void;
  onDeleteTask: (taskId: number) => Promise<void> | void;
}) {
  return (
    <div className="space-y-5">
      <SectionCard title="Add Task">
        <StatusMessage loading={tasksLoading} error={tasksError} loadingText="Loading tasks..." />
        <form onSubmit={onAddTask} className="space-y-3">
          <input
            type="text"
            value={newTaskTitle}
            onChange={(event) => onNewTaskTitleChange(event.target.value)}
            placeholder="Add a new task..."
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
          <textarea
            value={newTaskNotes}
            onChange={(event) => onNewTaskNotesChange(event.target.value)}
            placeholder="Optional task details..."
            className="min-h-24 w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
          <div className="flex flex-col gap-3 lg:flex-row">
            <select
              value={newTaskStatus}
              onChange={(event) =>
                onNewTaskStatusChange(event.target.value as "today" | "pending")
              }
              className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="pending">Pending Tasks</option>
              <option value="today">Today</option>
            </select>
            <button
              type="submit"
              disabled={!newTaskTitle.trim()}
              className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Add Task
            </button>
          </div>
        </form>
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2 md:gap-5 xl:grid-cols-4">
        <TaskGroup
          title={`Today (${todayTasks.length})`}
          tasks={todayTasks}
          onCompleteTask={onCompleteTask}
          onSaveTaskNotes={onSaveTaskNotes}
          onDeleteTask={onDeleteTask}
        />
        <TaskGroup
          title={`Upcoming (${upcomingTasks.length})`}
          tasks={upcomingTasks}
          onCompleteTask={onCompleteTask}
          onSaveTaskNotes={onSaveTaskNotes}
          onDeleteTask={onDeleteTask}
        />
        <TaskGroup
          title={`Pending (${pendingTasks.length})`}
          tasks={pendingTasks}
          onCompleteTask={onCompleteTask}
          onSaveTaskNotes={onSaveTaskNotes}
          onDeleteTask={onDeleteTask}
        />
        <TaskGroup
          title={`Completed (${completedTasks.length})`}
          tasks={completedTasks}
          onCompleteTask={onCompleteTask}
          onSaveTaskNotes={onSaveTaskNotes}
          onDeleteTask={onDeleteTask}
        />
      </div>
    </div>
  );
}

function NotesView({
  notes,
  selectedNote,
  notesLoading,
  notesError,
  onSelectNote,
  onCreateNote,
  onChangeNoteTitle,
  onChangeNoteContent,
  onDeleteNote,
}: {
  notes: Note[];
  selectedNote: Note | null;
  notesLoading: boolean;
  notesError: string;
  onSelectNote: (noteId: number) => void;
  onCreateNote: () => Promise<void> | void;
  onChangeNoteTitle: (title: string) => Promise<void> | void;
  onChangeNoteContent: (content: string) => Promise<void> | void;
  onDeleteNote: (noteId: number) => Promise<void> | void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr] lg:gap-5">
      <SectionCard title="Notes List">
        <StatusMessage loading={notesLoading} error={notesError} loadingText="Loading notes..." />
        <button
          type="button"
          onClick={onCreateNote}
          className="mb-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          New Note
        </button>

        <div className="space-y-3">
          {notes.map((note) => {
            const isActive = selectedNote?.id === note.id;

            return (
              <button
                key={note.id}
                type="button"
                onClick={() => onSelectNote(note.id)}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {note.title.trim() || "Untitled Note"}
                    </p>
                    <p
                      className={`mt-2 text-xs ${
                        isActive ? "text-slate-300" : "text-slate-400"
                      }`}
                    >
                      Created {formatCreatedAt(note.created_at)}
                    </p>
                  </div>
                  <span
                    className={`text-xs ${
                      isActive ? "text-slate-300" : "text-slate-400"
                    }`}
                  >
                    {note.content.trim() ? "Saved" : "Empty"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Note Editor">
        {selectedNote ? (
          <div className="flex h-full min-h-[360px] flex-col sm:min-h-[420px]">
            <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-slate-50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={selectedNote.title}
                  onChange={(event) => onChangeNoteTitle(event.target.value)}
                  placeholder="Note title"
                  className="w-full border-none bg-transparent text-lg font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                />
                <p className="mt-2 text-sm text-slate-500">
                  Created {formatCreatedAt(selectedNote.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDeleteNote(selectedNote.id)}
                className="min-h-10 rounded-xl px-3 text-xs font-medium text-slate-500 transition hover:bg-white hover:text-slate-900"
              >
                Delete
              </button>
            </div>

            <textarea
              value={selectedNote.content}
              onChange={(event) => onChangeNoteContent(event.target.value)}
              className="min-h-[260px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm leading-7 text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 sm:min-h-[320px]"
              placeholder="Write your note here..."
            />
          </div>
        ) : (
          <EmptyState
            title="No notes yet"
            description="Create a note to start capturing ideas, reminders, or plans."
          />
        )}
      </SectionCard>
    </div>
  );
}

function AssistantView({
  mode,
  onModeChange,
  messages,
  chatInput,
  onChatInputChange,
  onChatSubmit,
  assistantError,
  assistantDebugInfo,
  microphoneStatus,
  micTranscript,
  isMicListening,
  talkStatus,
  talkTranscript,
  talkReply,
  isPushToTalkActive,
  onEnableMicrophone,
  onStartMicListening,
  onPushToTalkStart,
  onPushToTalkEnd,
}: {
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  messages: Message[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onChatSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  assistantError: string;
  assistantDebugInfo: string;
  microphoneStatus: string;
  micTranscript: string;
  isMicListening: boolean;
  talkStatus: string;
  talkTranscript: string;
  talkReply: string;
  isPushToTalkActive: boolean;
  onEnableMicrophone: () => Promise<void> | void;
  onStartMicListening: () => Promise<void> | void;
  onPushToTalkStart: () => Promise<void> | void;
  onPushToTalkEnd: () => void;
}) {
  const modes: AssistantMode[] = ["Chat Mode", "Mic Mode", "Talk Mode"];
  const modeLabels: Record<AssistantMode, string> = {
    "Chat Mode": "Chat",
    "Mic Mode": "Mic",
    "Talk Mode": "Talk",
  };

  return (
    <SectionCard title="Assistant" className="overflow-visible">
      {assistantError && (
        <div className="mb-4 space-y-2">
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {assistantError}
          </p>
          {assistantDebugInfo && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 font-mono text-xs leading-6 text-amber-700">
              Debug: {assistantDebugInfo}
            </p>
          )}
        </div>
      )}
      <div className="sticky top-2 z-20 mb-5 grid grid-cols-3 gap-2 rounded-3xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur sm:static sm:mb-6 sm:flex sm:flex-wrap sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        {modes.map((item) => {
          const isActive = item === mode;

          return (
            <button
              key={item}
              type="button"
              onClick={() => onModeChange(item)}
              className={`min-h-12 rounded-2xl px-4 py-3 text-sm font-semibold transition sm:min-w-24 ${
                isActive
                  ? "bg-slate-900 text-white shadow-md"
                  : "bg-slate-50 text-slate-600 hover:bg-white sm:border sm:border-slate-200"
              }`}
            >
              {modeLabels[item]}
            </button>
          );
        })}
      </div>

      {mode === "Chat Mode" && (
        <div className="space-y-4 sm:space-y-5">
          <div className="flex min-h-[260px] flex-col justify-end gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 sm:min-h-[360px] sm:p-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "max-w-[92%] self-end rounded-2xl rounded-br-md bg-slate-200 px-4 py-3 text-sm leading-6 text-slate-700 sm:max-w-[80%]"
                    : "max-w-[92%] rounded-2xl rounded-bl-md bg-slate-900 px-4 py-3 text-sm leading-6 text-white sm:max-w-[80%]"
                }
              >
                {message.text}
              </div>
            ))}
          </div>

          <form onSubmit={onChatSubmit} className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm sm:flex sm:gap-3 sm:p-3">
            <input
              type="text"
              value={chatInput}
              onChange={(event) => onChatInputChange(event.target.value)}
              placeholder="Type your message..."
              className="min-h-12 w-full rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-200 sm:flex-1 sm:text-sm"
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              className="mt-2 min-h-12 w-full rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:mt-0 sm:w-auto"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {mode === "Mic Mode" && (
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center sm:min-h-[420px] sm:px-6">
          <button
            type="button"
            onClick={() => void onStartMicListening()}
            className={`flex h-24 w-24 items-center justify-center rounded-full text-lg font-semibold text-white shadow-lg shadow-slate-200 transition ${
              isMicListening ? "bg-slate-700" : "bg-slate-900 hover:bg-slate-800"
            }`}
          >
            Mic
          </button>
          <h3 className="mt-6 text-xl font-semibold text-slate-900">Mic Mode</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            Speak naturally and your transcript will be sent through the same
            assistant flow as Chat Mode.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => void onEnableMicrophone()}
              className="min-h-12 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400"
            >
              Enable Microphone
            </button>
            <button
              type="button"
              onClick={() => void onStartMicListening()}
              className="min-h-12 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              {isMicListening ? "Listening..." : "Start Listening"}
            </button>
          </div>
          <p className="mt-4 max-w-md text-sm text-slate-500">{microphoneStatus}</p>
          <div className="mt-4 w-full max-w-xl rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Transcript
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {micTranscript || "Your speech transcript will appear here."}
            </p>
          </div>
        </div>
      )}

      {mode === "Talk Mode" && (
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center sm:min-h-[420px] sm:px-6">
          <button
            type="button"
            onMouseDown={() => void onPushToTalkStart()}
            onMouseUp={onPushToTalkEnd}
            onMouseLeave={onPushToTalkEnd}
            onTouchStart={() => void onPushToTalkStart()}
            onTouchEnd={onPushToTalkEnd}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                void onPushToTalkStart();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                onPushToTalkEnd();
              }
            }}
            className={`min-h-16 rounded-full px-8 py-5 text-sm font-semibold text-white shadow-lg shadow-slate-300 transition ${
              isPushToTalkActive ? "bg-slate-700" : "bg-slate-900"
            }`}
          >
            Push to Talk
          </button>
          <h3 className="mt-6 text-xl font-semibold text-slate-900">Talk Mode</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            This is the first local step toward voice interaction. Press and hold
            to test the push-to-talk flow.
          </p>
          <p className="mt-4 max-w-md text-sm text-slate-500">{talkStatus}</p>
          <div className="mt-4 w-full max-w-xl rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Recognized Speech
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {talkTranscript || "Your recognized speech will appear here."}
            </p>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Assistant Reply
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {talkReply || "The assistant reply will appear here and play aloud when available."}
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function SettingsView({
  integrationStatuses,
  integrationsLoading,
  integrationsError,
}: {
  integrationStatuses: IntegrationStatus[];
  integrationsLoading: boolean;
  integrationsError: string;
}) {
  return (
    <SectionCard title="Settings">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-base font-semibold text-slate-900">Profile</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Add account details, preferences, and sync options here later.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-base font-semibold text-slate-900">Connected tools</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Calendar, email, and WhatsApp scaffolds are ready. Add provider credentials
            in `.env.local` to activate them.
          </p>
          <div className="mt-4 space-y-3">
            <StatusMessage
              loading={integrationsLoading}
              error={integrationsError}
              loadingText="Loading integration status..."
            />
            {!integrationsLoading &&
              !integrationsError &&
              integrationStatuses.map((integration) => (
                <div
                  key={integration.name}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{integration.name}</p>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        integration.configured
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {integration.configured ? "Ready" : "Setup needed"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {integration.summary}
                  </p>
                  {!integration.configured && integration.missingKeys.length > 0 && (
                    <p className="mt-2 font-mono text-xs leading-6 text-slate-400">
                      Missing: {integration.missingKeys.join(", ")}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function StatCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="mt-3 text-4xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

function SectionCard({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-[22px] border border-slate-200 bg-white p-3 shadow-sm sm:rounded-3xl sm:p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between sm:mb-5">
        <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function TaskPreviewList({
  tasks,
  emptyMessage,
}: {
  tasks: Task[];
  emptyMessage: string;
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-slate-400">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex flex-col gap-2 rounded-2xl border border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700">{task.title}</p>
            {task.notes.trim() && (
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{task.notes}</p>
            )}
          </div>
          <div className="text-sm uppercase tracking-[0.18em] text-slate-400">
            {task.status}
          </div>
        </div>
      ))}
    </div>
  );
}

function UpcomingTasksList({
  tasks,
}: {
  tasks: Task[];
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-slate-400">No upcoming tasks yet.</p>;
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="rounded-2xl border border-slate-200 px-4 py-3"
        >
          <p className="text-sm font-medium text-slate-700">
            {task.title} on {formatUpcomingTaskDate(task.due_date ?? task.created_at)}
          </p>
          {task.notes.trim() && (
            <p className="mt-2 text-sm leading-6 text-slate-500">{task.notes}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function AssistantActivityList({
  activities,
}: {
  activities: AssistantActivity[];
}) {
  if (activities.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Recent assistant actions will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className="rounded-2xl border border-slate-200 px-4 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-700">{activity.label}</p>
            <p className="text-xs text-slate-400">
              {formatCreatedAt(activity.created_at)}
            </p>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">{activity.detail}</p>
        </div>
      ))}
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  onCompleteTask,
  onSaveTaskNotes,
  onDeleteTask,
}: {
  title: string;
  tasks: Task[];
  onCompleteTask: (taskId: number) => void;
  onSaveTaskNotes: (taskId: number, nextNotes: string) => Promise<void> | void;
  onDeleteTask: (taskId: number) => void;
}) {
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<number, string>>({});

  function toggleTaskDetails(task: Task) {
    setExpandedTaskId((currentTaskId) =>
      currentTaskId === task.id ? null : task.id,
    );

    setDraftNotes((currentDrafts) => ({
      ...currentDrafts,
      [task.id]: currentDrafts[task.id] ?? task.notes,
    }));
  }

  async function saveTaskDetails(taskId: number) {
    await onSaveTaskNotes(taskId, draftNotes[taskId] ?? "");
  }

  return (
    <SectionCard title={title}>
      <div className="space-y-3">
        {tasks.length === 0 && (
          <p className="text-sm text-slate-400">No tasks in this section.</p>
        )}

        {tasks.map((task) => (
          <div
            key={task.id}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={task.status === "completed"}
                onChange={() => onCompleteTask(task.id)}
                className="mt-1 h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
              />
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${
                    task.status === "completed"
                      ? "text-slate-400 line-through"
                      : "text-slate-800"
                  }`}
                >
                  {task.title}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                  {task.status}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Created {formatCreatedAt(task.created_at)}
                </p>
                {task.notes.trim() && expandedTaskId !== task.id && (
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    {task.notes}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={() => toggleTaskDetails(task)}
                  className="min-h-10 rounded-xl px-3 text-xs font-medium text-slate-500 transition hover:bg-white hover:text-slate-900"
                >
                  {expandedTaskId === task.id ? "Hide Details" : "Edit Details"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteTask(task.id)}
                  className="min-h-10 rounded-xl px-3 text-xs font-medium text-slate-500 transition hover:bg-white hover:text-slate-900"
                >
                  {task.status === "completed" ? "Delete" : "Cancel"}
                </button>
              </div>
            </div>

            {expandedTaskId === task.id && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <textarea
                  value={draftNotes[task.id] ?? task.notes}
                  onChange={(event) =>
                    setDraftNotes((currentDrafts) => ({
                      ...currentDrafts,
                      [task.id]: event.target.value,
                    }))
                  }
                  placeholder="Add task details..."
                  className="min-h-24 w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveTaskDetails(task.id)}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    Save Details
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function AuthView({
  authMode,
  authEmail,
  authPassword,
  authError,
  onAuthModeChange,
  onAuthEmailChange,
  onAuthPasswordChange,
  onSubmit,
}: {
  authMode: "sign_in" | "sign_up";
  authEmail: string;
  authPassword: string;
  authError: string;
  onAuthModeChange: (mode: "sign_in" | "sign_up") => void;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
}) {
  return (
    <SectionCard title="Welcome">
      <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            Test Mode
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-slate-950">
            Create your own private workspace
          </h3>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            Each tester can sign in with email and password, then keep separate
            tasks, notes, and assistant activity without paying for a production setup.
          </p>
          <div className="mt-6 space-y-3 text-sm text-slate-500">
            <p>Use email sign-up to create a test account.</p>
            <p>Supabase free tier is enough for private testing with a few friends.</p>
            <p>Your assistant data stays scoped to the signed-in account.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex gap-3">
            <button
              type="button"
              onClick={() => onAuthModeChange("sign_in")}
              className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                authMode === "sign_in"
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => onAuthModeChange("sign_up")}
              className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                authMode === "sign_up"
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Sign Up
            </button>
          </div>

          {authError && (
            <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {authError}
            </p>
          )}

          <div className="space-y-3">
            <input
              type="email"
              value={authEmail}
              onChange={(event) => onAuthEmailChange(event.target.value)}
              placeholder="Email address"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
            <input
              type="password"
              value={authPassword}
              onChange={(event) => onAuthPasswordChange(event.target.value)}
              placeholder="Password"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              {authMode === "sign_in" ? "Sign In" : "Create Account"}
            </button>
          </div>
        </form>
      </div>
    </SectionCard>
  );
}

function StatusMessage({
  loading,
  error,
  loadingText,
}: {
  loading: boolean;
  error: string;
  loadingText: string;
}) {
  if (loading) {
    return <p className="mb-4 text-sm text-slate-400">{loadingText}</p>;
  }

  if (error) {
    return <p className="mb-4 text-sm text-rose-500">{error}</p>;
  }

  return null;
}
