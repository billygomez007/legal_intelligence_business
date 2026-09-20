export interface MatterResearchItem {
  id: string;
  title: string;
  type: string;
  status: string;
  updated: string;
}

export interface MatterDocument {
  id: string;
  name: string;
  category: string;
  version: string;
  updated: string;
  status: string;
}

export interface MatterTask {
  id: string;
  title: string;
  assignee: string;
  due: string;
  priority: 'High' | 'Normal';
  status: 'Open' | 'In progress' | 'Done';
}

export interface MatterAppointment {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  type: string;
}

export interface MatterDeadline {
  id: string;
  title: string;
  date: string;
  time: string;
  type: string;
  priority: 'High' | 'Normal';
}

export interface MatterNote {
  id: string;
  title: string;
  author: string;
  updated: string;
  body: string;
}

export interface MatterActivity {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
  detail: string;
}

export interface MatterBillingEntry {
  id: string;
  description: string;
  professional: string;
  date: string;
  hours: number;
  rate: number;
  amount: number;
  status: string;
}

export interface MatterWorkspaceRecord {
  id: string;
  title: string;
  reference: string;
  client: string;
  practiceArea: string;
  status: string;
  leadLawyer: string;
  opened: string;
  description: string;
  research: MatterResearchItem[];
  documents: MatterDocument[];
  tasks: MatterTask[];
  appointments: MatterAppointment[];
  deadlines: MatterDeadline[];
  notes: MatterNote[];
  activity: MatterActivity[];
  billing: MatterBillingEntry[];
}

export const matterWorkspaceRecords: MatterWorkspaceRecord[] = [
  {
    id: 'sample-contract-dispute',
    title: 'Sample Contract Dispute',
    reference: 'DEMO-MAT-001',
    client: 'Sample Client A',
    practiceArea: 'Commercial',
    status: 'Active',
    leadLawyer: 'Billy Gomez',
    opened: '12 Sep 2026',
    description:
      'Synthetic demonstration matter used to show how LexGhana can connect legal research, documents, appointments, deadlines, notes and billing information.',
    research: [
      {
        id: 'DEMO-RES-001',
        title: 'Contract formation and enforceability',
        type: 'Case research',
        status: 'In progress',
        updated: '2 hours ago',
      },
      {
        id: 'DEMO-RES-002',
        title: 'Available remedies research',
        type: 'Legal principle',
        status: 'Needs review',
        updated: '1 day ago',
      },
      {
        id: 'DEMO-RES-003',
        title: 'Procedural issues research',
        type: 'Procedure',
        status: 'Saved',
        updated: '2 days ago',
      },
    ],
    documents: [
      {
        id: 'DEMO-DOC-001',
        name: 'Sample client instructions',
        category: 'Client document',
        version: 'v1',
        updated: '20 Sep 2026',
        status: 'Demo',
      },
      {
        id: 'DEMO-DOC-002',
        name: 'Example contract document',
        category: 'Evidence',
        version: 'v2',
        updated: '19 Sep 2026',
        status: 'Demo',
      },
      {
        id: 'DEMO-DOC-003',
        name: 'Research memorandum draft',
        category: 'Work product',
        version: 'v1',
        updated: '20 Sep 2026',
        status: 'Draft',
      },
    ],
    tasks: [
      {
        id: 'DEMO-TASK-001',
        title: 'Review sample contract terms',
        assignee: 'Billy Gomez',
        due: '22 Sep 2026',
        priority: 'High',
        status: 'In progress',
      },
      {
        id: 'DEMO-TASK-002',
        title: 'Prepare demonstration research memorandum',
        assignee: 'Example Researcher',
        due: '23 Sep 2026',
        priority: 'Normal',
        status: 'Open',
      },
      {
        id: 'DEMO-TASK-003',
        title: 'Confirm next client conference',
        assignee: 'Billy Gomez',
        due: '21 Sep 2026',
        priority: 'Normal',
        status: 'Done',
      },
    ],
    appointments: [
      {
        id: 'DEMO-APT-001',
        title: 'Client conference',
        date: '22 Sep 2026',
        time: '09:30',
        location: 'Accra Office',
        type: 'In person',
      },
      {
        id: 'DEMO-APT-002',
        title: 'Internal matter review',
        date: '23 Sep 2026',
        time: '14:00',
        location: 'LexGhana Workspace',
        type: 'Internal',
      },
    ],
    deadlines: [
      {
        id: 'DEMO-DL-001',
        title: 'Sample internal review deadline',
        date: '24 Sep 2026',
        time: '16:00',
        type: 'Internal',
        priority: 'High',
      },
      {
        id: 'DEMO-DL-002',
        title: 'Example research memo due',
        date: '26 Sep 2026',
        time: '12:00',
        type: 'Research',
        priority: 'Normal',
      },
    ],
    notes: [
      {
        id: 'DEMO-NOTE-001',
        title: 'Initial matter note',
        author: 'Billy Gomez',
        updated: '20 Sep 2026 · 09:15',
        body: 'Demonstration note only. Record the core questions, research direction and next actions for the matter here.',
      },
      {
        id: 'DEMO-NOTE-002',
        title: 'Research review note',
        author: 'Example Researcher',
        updated: '20 Sep 2026 · 11:30',
        body: 'Review the saved demonstration authorities and verify every proposition against the underlying source passage.',
      },
    ],
    activity: [
      {
        id: 'DEMO-ACT-001',
        action: 'Research saved',
        actor: 'Billy Gomez',
        timestamp: '20 Sep 2026 · 11:45',
        detail: 'Added demonstration contract research to the matter.',
      },
      {
        id: 'DEMO-ACT-002',
        action: 'Document updated',
        actor: 'Example Researcher',
        timestamp: '20 Sep 2026 · 10:20',
        detail: 'Updated the demonstration research memorandum draft.',
      },
      {
        id: 'DEMO-ACT-003',
        action: 'Appointment created',
        actor: 'Billy Gomez',
        timestamp: '19 Sep 2026 · 16:10',
        detail: 'Added a demonstration client conference.',
      },
    ],
    billing: [
      {
        id: 'DEMO-TIME-001',
        description: 'Legal research',
        professional: 'Billy Gomez',
        date: '20 Sep 2026',
        hours: 1.5,
        rate: 0,
        amount: 0,
        status: 'Demonstration',
      },
      {
        id: 'DEMO-TIME-002',
        description: 'Matter review',
        professional: 'Example Researcher',
        date: '19 Sep 2026',
        hours: 0.8,
        rate: 0,
        amount: 0,
        status: 'Demonstration',
      },
    ],
  },
];

export function getMatterWorkspace(id: string): MatterWorkspaceRecord | undefined {
  return matterWorkspaceRecords.find((matter) => matter.id === id);
}
