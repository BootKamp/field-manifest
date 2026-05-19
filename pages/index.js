import dynamic from "next/dynamic";
import Head from "next/head";

// Dynamically import the main component with SSR disabled.
// The component uses window.storage, document, and other browser-only APIs.
const FieldManifest = dynamic(() => import("../components/FieldManifest"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#EFE3C2",
        color: "#1C1813",
        fontFamily: "'Fraunces', Georgia, serif",
        fontStyle: "italic",
        fontSize: 18,
      }}
    >
      Loading the manifest…
    </div>
  ),
});

export default function Home() {
  return (
    <>
      <Head>
        <title>The Field Manifest · BootKamp</title>
      </Head>
      <FieldManifest />
    </>
  );
}
