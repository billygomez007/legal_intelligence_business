# Core Data Model

## Jurisdiction
id, name, code, hierarchy configuration.

## Court
id, jurisdiction_id, name, level, predecessor/successor metadata.

## Judge
id, canonical_name, aliases.

## LegalDocument
id, jurisdiction_id, document_type, title, source_id, source_url/reference, publication_date, version, rights_status, checksum, review_status.

## Case
document_id, case_name, citation, docket/reference, court_id, decision_date, procedural_posture.

## Legislation
document_id, instrument_type, number, enactment_date, commencement_date, repeal_status.

## Provision
id, legislation_id, label, heading, text, effective_from, effective_to.

## Passage
id, document_id, paragraph/page locator, text, embedding reference, extraction confidence.

## Citation
id, from_document_id, to_document_id/provision_id, citation_text, locator, relationship_type, confidence, review_status.

## LegalConcept
id, name, parent_id, jurisdiction_id.

## DocumentConcept
document_id, concept_id, confidence, review_status.

## Organization
id, name, plan.

## User
id, identity fields, organization memberships.

## ResearchProject
id, organization_id/user_id, title, matter reference.

## SavedAuthority / Note
project_id, document_id/passage_id, note content.

## AIResearchRun
id, tenant scope, user_id, query, model_version, retrieval_trace, answer, verification_state.

## PrivateDocument
id, organization_id, object reference, metadata, processing state.

## Alert
id, owner, query/topic configuration, cadence/status.
