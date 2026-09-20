import type { WebClients } from './contracts';
import { alerts, answer, authorities, passages, projects, workspace } from './fixtures';
import type { SearchQuery } from './types';
export const emptySearch: SearchQuery = {
  text: '',
  jurisdiction: '',
  court: '',
  kind: '',
  year: '',
  practiceArea: '',
  concept: '',
};
/** Read-only fixtures. Clone on return so callers cannot mutate shared request data. No private data exists here. */
export const webClients: WebClients = {
  authorities: {
    list: () => Promise.resolve(structuredClone(authorities)),
    get: (id) => Promise.resolve(structuredClone(authorities.find((item) => item.id === id))),
    source: (id) => {
      const authority = authorities.find((item) => item.id === id);
      if (!authority) return Promise.resolve(undefined);
      const visible =
        authority.rights === 'available' ? passages.filter((item) => item.documentId === id) : [];
      return Promise.resolve(
        structuredClone({
          authority,
          documentId: id,
          passageIds: visible.map((p) => p.id),
          passages: visible,
        }),
      );
    },
  },
  search: {
    search: (query) =>
      Promise.resolve(
        structuredClone(
          authorities
            .filter((item) => {
              const textMatch = `${item.title} ${item.excerpt} ${item.identifier} ${item.concept}`
                .toLowerCase()
                .includes(query.text.trim().toLowerCase());
              return (
                textMatch &&
                (!query.jurisdiction || item.jurisdiction === query.jurisdiction) &&
                (!query.court || item.source === query.court) &&
                (!query.kind || item.kind === query.kind) &&
                (!query.year || item.date.startsWith(query.year)) &&
                (!query.practiceArea || item.practiceArea === query.practiceArea) &&
                (!query.concept || item.concept === query.concept)
              );
            })
            .map((authority) => ({
              authority,
              matchingPassageIds:
                authority.rights === 'available'
                  ? passages.filter((p) => p.documentId === authority.id).map((p) => p.id)
                  : [],
            })),
        ),
      ),
  },
  research: {
    list: () => Promise.resolve(structuredClone(projects)),
    get: (id) => Promise.resolve(structuredClone(projects.find((p) => p.id === id))),
    exampleAnswer: () => Promise.resolve(structuredClone(answer)),
  },
  alerts: { list: () => Promise.resolve(structuredClone(alerts)) },
  workspace: { overview: () => Promise.resolve(structuredClone(workspace)) },
};
