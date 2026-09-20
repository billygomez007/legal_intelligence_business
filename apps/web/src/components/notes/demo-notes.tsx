'use client';

import { useState } from 'react';
import { LayerPanel } from '../legal';

/** The user-note layer. Text lives in component state only and is lost on navigation. */
export function DemoNotes({ initialNote }: { initialNote: string }) {
  const [note, setNote] = useState(initialNote);
  return (
    <LayerPanel layer="note" detail="local preview" ariaLabel="User note" className="note-editor">
      <label className="field">
        <span>Research notes</span>
        <textarea
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          placeholder="Write an example note…"
          maxLength={5000}
        />
      </label>
      <p className="micro">
        Changes stay in this view and are lost on reload or navigation. Do not enter confidential
        information.
      </p>
    </LayerPanel>
  );
}
