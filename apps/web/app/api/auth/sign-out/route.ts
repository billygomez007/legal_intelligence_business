import { NextResponse } from 'next/server';

import { clearLawAfriqueSessionCookie } from '../../../../lib/server-session';

export async function POST() {
  await clearLawAfriqueSessionCookie();

  return NextResponse.json(
    {
      data: {
        signedOut: true,
      },
    },
    {
      status: 200,
    },
  );
}
