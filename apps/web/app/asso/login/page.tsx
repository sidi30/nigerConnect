// Server component: a client component cannot export `metadata`. It renders the
// client-side login form below.
import AssoLoginForm from "@/components/asso/LoginForm";

export const metadata = {
  title: "Espace association — Connexion",
  robots: { index: false, follow: false },
};

export default function AssoLoginPage() {
  return <AssoLoginForm />;
}
