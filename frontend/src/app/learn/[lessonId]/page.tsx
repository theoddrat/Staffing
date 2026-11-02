"use client";

import { useParams } from "next/navigation";
import { LessonPlayer } from "@/components/lesson/LessonPlayer";

export default function LessonPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  return <LessonPlayer id={lessonId} />;
}
