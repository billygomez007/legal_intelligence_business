import {
  GoogleSignIn,
} from '../../components/google-sign-in';

export default function SignInPage() {
  return (
    <main
      style={{
        minHeight:
          '100vh',

        display:
          'grid',

        placeItems:
          'center',

        padding:
          '24px',
      }}
    >
      <section
        style={{
          width:
            'min(620px, 100%)',

          padding:
            '48px',

          border:
            '1px solid rgba(216,178,94,.28)',

          borderRadius:
            '28px',

          background:
            'rgba(11,17,26,.94)',

          boxShadow:
            '0 36px 120px rgba(0,0,0,.5)',
        }}
      >
        <div
          style={{
            color:
              '#d8b25e',

            fontSize:
              '12px',

            fontWeight:
              800,

            letterSpacing:
              '.18em',

            textTransform:
              'uppercase',
          }}
        >
          Law Afrique
        </div>

        <h1
          style={{
            margin:
              '14px 0',

            fontSize:
              'clamp(42px, 7vw, 64px)',

            lineHeight:
              1,
          }}
        >
          Legal intelligence,
          built for serious work.
        </h1>

        <p
          style={{
            maxWidth:
              '520px',

            marginBottom:
              '30px',

            color:
              '#9da9b9',

            fontSize:
              '17px',

            lineHeight:
              1.7,
          }}
        >
          Sign in securely with Google
          to access your Law Afrique
          workspace.
        </p>

        <GoogleSignIn />

        <p
          style={{
            marginTop:
              '28px',

            color:
              '#687589',

            fontSize:
              '12px',

            lineHeight:
              1.6,
          }}
        >
          Google verifies your identity.
          Law Afrique then issues its own
          application session.
        </p>
      </section>
    </main>
  );
}
