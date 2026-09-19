# Security & Privacy

## Threat Model
The platform may hold confidential legal documents and sensitive personal information. Security is a product requirement.

## Controls
- Encryption in transit and at rest
- Tenant-scoped authorization
- RBAC for organizations
- Secure object storage
- Secret management
- Audit logging
- Backups and restore testing
- Dependency and vulnerability scanning
- Rate limiting
- Secure session management
- Data retention/deletion workflows

## AI Privacy
- Do not send more private content to model providers than necessary.
- Contract/configuration choices must reflect customer confidentiality requirements.
- Log retrieval identifiers rather than unnecessary full document content.
- Separate public and private indexes.
- Test cross-tenant retrieval leakage.

## Uploaded Documents
Treat uploaded content as untrusted. Scan/validate file types and defend against prompt injection and malicious embedded instructions.

## Enterprise
Prepare DPA, subprocessor inventory, incident process and security documentation before enterprise scale.
