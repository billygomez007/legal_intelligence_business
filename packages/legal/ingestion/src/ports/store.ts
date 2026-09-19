import type {
  Artifact,
  Extraction,
  FailureCategory,
  IngestionRequest,
  Job,
  ParsedDocument,
  Stage,
} from '../domain/model';
import type { JobQueue } from './pipeline';
export interface IngestionStore extends JobQueue {
  request(input: IngestionRequest): Promise<Job>;
  get(id: string): Promise<Job>;
  withLock<T>(id: string, work: () => Promise<T>): Promise<T | null>;
  claim(id: string): Promise<Job | null>;
  stage(job: Job, stage: Stage): Promise<void>;
  artifact(job: Job): Promise<Artifact | null>;
  saveArtifact(job: Job, key: string, byteSize: number, durationMs: number): Promise<Artifact>;
  extraction(job: Job): Promise<Extraction | null>;
  saveExtraction(
    job: Job,
    artifact: Artifact,
    extraction: Extraction,
    durationMs: number,
  ): Promise<void>;
  submit(
    job: Job,
    artifact: Artifact,
    extraction: Extraction,
    parsed: ParsedDocument,
    durationMs: number,
  ): Promise<void>;
  fail(job: Job, category: FailureCategory, durationMs: number): Promise<void>;
}
