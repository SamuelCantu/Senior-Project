// Return to original page
import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-20 text-gray-900">
      <section className="mx-auto max-w-md text-center">
        <h1 className="mb-4 text-3xl font-bold text-blue-600">ListNexus</h1>
        <h2 className="mb-3 text-2xl font-semibold">Log in</h2>
        <p className="mb-8 text-gray-600">
          I am aware the login field is being worked on by Sam, this has yet to be implemented in the main branch.
        </p>

        <Link
          className="mb-4 inline-block text-blue-600 hover:underline"
          href="/register"
        >
          Register
        </Link>
        <br />
        <Link className="text-blue-600 hover:underline" href="/">
          Back to home
        </Link>
        
      </section>
    </main>
  );
}