import type {
  Alert,
  Authority,
  LegalAnswer,
  ResearchProject,
  SearchQuery,
  SearchResult,
  SourceReference,
  WorkspaceOverview,
} from './types';
export interface LegalSearchClient {
  search(query: SearchQuery): Promise<SearchResult[]>;
}
export interface AuthorityClient {
  list(): Promise<Authority[]>;
  get(id: string): Promise<Authority | undefined>;
  source(id: string): Promise<SourceReference | undefined>;
}
export interface ResearchClient {
  list(): Promise<ResearchProject[]>;
  get(id: string): Promise<ResearchProject | undefined>;
  exampleAnswer(): Promise<LegalAnswer>;
}
export interface AlertsClient {
  list(): Promise<Alert[]>;
}
export interface WorkspaceClient {
  overview(): Promise<WorkspaceOverview>;
}
export interface WebClients {
  search: LegalSearchClient;
  authorities: AuthorityClient;
  research: ResearchClient;
  alerts: AlertsClient;
  workspace: WorkspaceClient;
}
