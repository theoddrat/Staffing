// Friendly names for the types generated from the backend's OpenAPI schema.
// Regenerate with `npm run gen:api` after changing backend models.
import type { components } from "./api-schema";

type S = components["schemas"];

export type AIStatus = S["AIStatus"];
export type Alternative = S["Alternative"];
export type AlternativeOut = S["AlternativeOut"];
export type AnswerOut = S["AnswerOut"];
export type AttemptOut = S["AttemptOut"];
export type AttemptSummary = S["AttemptSummary"];
export type ConceptStateOut = S["ConceptStateOut"];
export type CurriculumOut = S["CurriculumOut"];
export type EventOut = S["EventOut"];
export type Example = S["Example"];
export type GeneratedTermOut = S["GeneratedTermOut"];
export type GeneratorOut = S["GeneratorOut"];
export type HealthOut = S["HealthOut"];
export type LessonOut = S["LessonOut"];
export type LessonPublic = S["LessonPublic"];
export type MessageOut = S["MessageOut"];
export type MistakeOut = S["MistakeOut"];
export type NodeOut = S["NodeOut"];
export type NotationLine = S["NotationLine"];
export type OpenLessonOut = S["OpenLessonOut"];
export type PracticeOut = S["PracticeOut"];
export type ProgressOut = S["ProgressOut"];
export type QuestionProgress = S["QuestionProgress"];
export type QuestionPublic = S["QuestionPublic"];
export type ReadinessOut = S["ReadinessOut"];
export type StageOut = S["StageOut"];
export type Statement = S["Statement"];
export type StatementOut = S["StatementOut"];
export type SymbolIntro = S["SymbolIntro"];
export type Term = S["Term"];
export type TermOut = S["TermOut"];
export type TermSummary = S["TermSummary"];
export type ThreadOut = S["ThreadOut"];
export type ThreadSummary = S["ThreadSummary"];
export type Visual = S["Visual"];
export type WonderingOut = S["WonderingOut"];

export type KnowledgeState = ConceptStateOut["state"];
export type StatementKind = Statement["kind"];
