import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-20 text-gray-900">
      <section className="mx-auto max-w-md">
        <h1 className="mb-4 text-center text-3xl font-bold text-blue-600">
          ListNexus
        </h1>
        <h2 className="mb-3 text-center text-2xl font-semibold">Log in</h2>
        <p className="mb-8 text-center text-gray-600">
          Sign in to manage your listings and inventory.
        </p>

        {/* Login form */}
        <form className="space-y-5">
          <div>
            <label className="mb-2 block font-medium" htmlFor="email">
              Email
            </label>
            <input
              className="w-full rounded-lg border px-4 py-3"
              id="email"
              type="email"
              placeholder="you@example.com"
            />
          </div>

          {/* Password field */}
          <div>
            <label className="mb-2 block font-medium" htmlFor="password">
              Password
            </label>
            <input
              className="w-full rounded-lg border px-4 py-3"
              id="password"
              type="password"
              placeholder="Enter your password"
            />
          </div>

          {/* Login button */}
          <button
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700"
            type="button"
          >
            Log in
          </button>
        </form>

        {/* Link back to homepage */}
        <div className="mt-6 flex justify-between text-sm">
          <Link className="text-blue-600 hover:underline" href="/">
            Back to home
          </Link>

          {/* Register button! */}
          <Link className="text-blue-600 hover:underline" href="/register">
            Register
          </Link>
        </div>
      </section>
    </main>
  );
}