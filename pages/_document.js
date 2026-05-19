import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en-AU">
      <Head>
        <meta charSet="utf-8" />
        <meta name="description" content="The Field Manifest — BootKamp's 4WD trip planner. Packing, payload, and live fuel route planning for Australia's big drives." />

        {/* PWA */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#A8471A" />
        <meta name="background-color" content="#EFE3C2" />

        {/* iOS-specific PWA */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Field Manifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

        {/* Standard favicons */}
        <link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16.png" />

        {/* Open Graph */}
        <meta property="og:title" content="The Field Manifest · BootKamp" />
        <meta property="og:description" content="Editorial 4WD trip planner — what to pack, what your rig will weigh, where to fuel up." />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/icons/og-image.png" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="The Field Manifest · BootKamp" />
        <meta name="twitter:description" content="Editorial 4WD trip planner — what to pack, what your rig will weigh, where to fuel up." />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
