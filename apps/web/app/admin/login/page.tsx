// Server component: exports `robots: noindex` metadata (a client component
// cannot export metadata). It renders the client-side login form below.
import LoginForm from "@/components/admin/LoginForm";

export const metadata = {
  title: "Admin — Connexion",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return <LoginForm />;
}
