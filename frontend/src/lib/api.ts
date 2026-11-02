"use client";

import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";
import type {
  AIStatus,
  AlternativeOut,
  AnswerOut,
  AttemptOut,
  AttemptSummary,
  CurriculumOut,
  EventOut,
  GeneratedTermOut,
  GeneratorOut,
  HealthOut,
  LessonOut,
  MessageOut,
  MistakeOut,
  OpenLessonOut,
  PracticeOut,
  ProgressOut,
  TermOut,
  TermSummary,
  ThreadOut,
  ThreadSummary,
  WonderingOut,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the backend. Is it running? (see README: start the backend on port 8000)");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const detail = body?.detail;
    const msg = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : res.statusText;
    throw new ApiError(res.status, msg || `Request failed (${res.status})`);
  }
  return body as T;
}

export const get = <T,>(path: string) => request<T>(path);
export const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = (path: string) => request<void>(path, { method: "DELETE" });

const fetcher = <T,>(path: string) => get<T>(path);

function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, fetcher, { revalidateOnFocus: false, ...config });
}

// ------------------------------------------------------------------ queries

export const useHealth = () => useApi<HealthOut>("/health");
export const useCurriculum = () => useApi<CurriculumOut>("/curriculum", { revalidateIfStale: false });
export const useProgress = () => useApi<ProgressOut>("/progress");
export const useLesson = (id: string | null) => useApi<LessonOut>(id ? `/lessons/${id}` : null);
export const useDictionary = () => useApi<TermSummary[]>("/dictionary");
export const useTerm = (id: string | null) => useApi<TermOut>(id ? `/dictionary/${id}` : null);
export const useDrafts = () => useApi<GeneratedTermOut[]>("/dictionary/drafts");
export const useHistory = (limit = 200) => useApi<EventOut[]>(`/history?limit=${limit}`);
export const useMistakes = () => useApi<MistakeOut[]>("/progress/mistakes");
export const useAIStatus = () => useApi<AIStatus>("/ai/status");
export const useThreads = () => useApi<ThreadSummary[]>("/tutor/threads");
export const useThread = (id: string | null) => useApi<ThreadOut>(id ? `/tutor/threads/${id}` : null);
export const useGenerators = () => useApi<GeneratorOut[]>("/practice/generators", { revalidateIfStale: false });
export const useWonderings = () => useApi<WonderingOut[]>("/wonderings");

/** Refresh everything that depends on the learner's progress. */
export function refreshProgress() {
  return globalMutate((key) => typeof key === "string" && /^\/(progress|lessons|dictionary|history)/.test(key));
}

// ------------------------------------------------------------------ actions

export const api = {
  openLesson: (id: string) => post<OpenLessonOut>(`/lessons/${id}/open`),
  lessonEvent: (id: string, type: string, data: Record<string, unknown> = {}) =>
    post<void>(`/lessons/${id}/events`, { type, data }),
  explainDifferently: (id: string, section: string | null, seen: string[], useAi = false) =>
    post<AlternativeOut>(`/lessons/${id}/explain-differently`, { section, seen, use_ai: useAi }),
  startAttempt: (id: string, mode: "lesson" | "test_out" | "review" = "lesson") =>
    post<AttemptOut>(`/lessons/${id}/assessment`, { mode }),
  answer: (attemptId: string, questionId: string, answer: Record<string, unknown>) =>
    post<AnswerOut>(`/attempts/${attemptId}/answer`, { question_id: questionId, answer }),
  finish: (attemptId: string) => post<AttemptSummary>(`/attempts/${attemptId}/finish`),
  practice: (generator: string, lessonId?: string) => post<PracticeOut>(`/practice/${generator}`, { lesson_id: lessonId ?? null }),
  practiceAnswer: (itemId: string, answer: Record<string, unknown>) =>
    post<AnswerOut>(`/practice/items/${itemId}/answer`, { answer }),
  termViewed: (id: string) => post<TermSummary>(`/dictionary/${id}/viewed`),
  draftTerm: (word: string, context?: string) => post<GeneratedTermOut>("/dictionary/draft", { word, context }),
  createThread: (body: { lesson_id?: string | null; mode?: "teaching" | "research"; title?: string }) =>
    post<ThreadOut>("/tutor/threads", body),
  sendMessage: (threadId: string, content: string, lessonId?: string | null, section?: string | null) =>
    post<MessageOut>(`/tutor/threads/${threadId}/messages`, { content, lesson_id: lessonId ?? null, section: section ?? null }),
  deleteThread: (id: string) => del(`/tutor/threads/${id}`),
  addWondering: (text: string, lessonId?: string | null) => post<WonderingOut>("/wonderings", { text, lesson_id: lessonId ?? null }),
  updateWondering: (id: number, body: { status?: string; note?: string }) => patch<WonderingOut>(`/wonderings/${id}`, body),
  deleteWondering: (id: number) => del(`/wonderings/${id}`),
  exportData: () => get<Record<string, unknown>>("/progress/export"),
  importData: (data: unknown) => post<void>("/progress/import", data),
  reset: () => post<void>("/progress/reset", { confirm: "RESET" }),
};
