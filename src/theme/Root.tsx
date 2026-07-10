import React, {useEffect} from 'react';
import Head from '@docusaurus/Head';

const SITE_URL = 'https://docs.radmodules.dev';

// Infima's default surface/text colors per color mode (see the theme-color
// meta tags below for the matching background values), since this widget's
// colors are fixed at mount time rather than reacting to a later theme toggle.
const FLOWISE_THEME_BY_MODE = {
  light: {primary: '#2e8555', background: '#ffffff', surface: '#f5f6f7', text: '#1c1e21'},
  dark: {primary: '#25c2a0', background: '#1b1b1d', surface: '#242526', text: '#e3e3e3'},
};

const FLOWISE_SCRIPT_ID = 'flowise-chatbot-95f80df9';

function initFlowiseChatbot() {
  // Avoid double-injection under React Strict Mode's double-invoked effects (dev only).
  if (document.getElementById(FLOWISE_SCRIPT_ID)) return;

  const mode = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const {primary, background, surface, text} = FLOWISE_THEME_BY_MODE[mode];

  // Injected as a literal inline `type="module"` script (not a JS `import()`
  // call) so the Webpack/Rspack SSR bundler never sees an import expression
  // to statically analyze — a real `import()` here builds fine client-side
  // but fails Docusaurus's server bundle with "UnhandledSchemeError: Reading
  // from https: is not handled by plugins", since webpackIgnore isn't
  // honored by the SSR compiler. This mirrors the same pattern used for the
  // Next.js and static-HTML embeds elsewhere in this project.
  const script = document.createElement('script');
  script.id = FLOWISE_SCRIPT_ID;
  script.type = 'module';
  script.textContent = `
    import Chatbot from "https://cdn.jsdelivr.net/npm/flowise-embed/dist/web.js"
    Chatbot.init(${JSON.stringify({
      chatflowid: '95f80df9-7111-4205-9f20-7bc9e20006ae',
      apiHost: 'https://flowise.radbusiness.dev',
      theme: {
        button: {
          backgroundColor: primary,
          iconColor: '#ffffff',
        },
        tooltip: {
          tooltipBackgroundColor: primary,
          tooltipTextColor: '#ffffff',
        },
        chatWindow: {
          backgroundColor: background,
          titleBackgroundColor: primary,
          titleTextColor: '#ffffff',
          fontSize: 12,
          botMessage: {
            backgroundColor: surface,
            textColor: text,
          },
          userMessage: {
            backgroundColor: primary,
            textColor: '#ffffff',
          },
          textInput: {
            backgroundColor: surface,
            textColor: text,
            sendButtonColor: primary,
          },
          footer: {
            showFooter: false,
          },
        },
      },
    })})
  `;
  document.body.appendChild(script);
}

export default function Root({children}) {
  useEffect(() => {
    initFlowiseChatbot();
  }, []);

  return (
    <>
      <Head>
        {/* Mobile browser chrome colour */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1b1b1d" />

        {/* Open Graph */}
        <meta property="og:site_name" content="RAD Platform Documentation" />
        <meta property="og:locale" content="en_US" />

        {/* Twitter */}
        <meta name="twitter:site" content="@techequitycloud" />
        <meta name="twitter:creator" content="@techequitycloud" />

        {/* Indexing */}
        <meta name="robots" content="index, follow" />
        <meta name="googlebot" content="index, follow" />
        <meta name="author" content="Tech Equity Cloud" />

        {/* Structured Data - Organization */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Tech Equity Cloud',
            url: SITE_URL,
            logo: `${SITE_URL}/img/logo.svg`,
            description: 'Google Cloud certification training and hands-on lab platform',
            sameAs: [
              'https://github.com/techequitycloud',
              'https://www.linkedin.com/company/techequitycloud',
              'https://twitter.com/techequitycloud'
            ]
          })}
        </script>

        {/* Structured Data - WebSite */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'RAD Platform Documentation',
            url: SITE_URL,
            description: 'Hands-on Google Cloud certification training — structured modules, labs, and certification guides from Associate to Professional level',
            publisher: {
              '@type': 'Organization',
              name: 'Tech Equity Cloud'
            },
            potentialAction: {
              '@type': 'SearchAction',
              target: `${SITE_URL}/search?q={search_term_string}`,
              'query-input': 'required name=search_term_string'
            }
          })}
        </script>
      </Head>
      {children}
    </>
  );
}
