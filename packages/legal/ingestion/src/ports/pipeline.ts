import type {
  Artifact,
  Extraction,
  IngestionRequest,
  MediaType,
  ParsedDocument,
} from '../domain/model';

/** Only provisioned public-corpus inbox objects; never tenant keys, paths or URLs. */
export interface SourceAcquirer {
  acquire(request: IngestionRequest): Promise<Uint8Array>;
}
/** Objects are immutable, protected and source-scoped. No public-URL method. */
export interface ArtifactStorage {
  put(sourceId: string, checksum: string, bytes: Uint8Array): Promise<string>;
  get(sourceId: string, key: string, checksum: string): Promise<Uint8Array>;
}
export interface TextExtractor {
  extract(bytes: Uint8Array, mediaType: MediaType): Promise<Extraction>;
}
/** Future isolated OCR worker; invoked only after an explicit human decision. */
export interface OcrExtractor {
  recognize(artifact: Artifact): Promise<Extraction>;
}
export interface DocumentParser {
  readonly id: string;
  parse(extraction: Extraction, request: IngestionRequest): ParsedDocument;
}
/** Durable queue enumeration; execution is separately locked and resumable. */
export interface JobQueue {
  ready(limit: number): Promise<string[]>;
}
