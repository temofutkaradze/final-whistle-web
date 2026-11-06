import Link from "next/link";

export default function BackToDashboard() {
  return <Link className="back-to-dashboard" href="/dashboard"><span aria-hidden="true">&#8592;</span> Back to Dashboard</Link>;
}
