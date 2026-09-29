export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="flex items-center justify-between px-10 py-6 bg-white shadow-sm">
        <h1 className="text-2xl font-bold text-blue-600">ListNexus</h1>

        <div className="flex gap-6 text-sm font-medium">
          <a href="#features" className="hover:text-blue-600">
            Features
          </a>

          <a href="#about" className="hover:text-blue-600">
            About
          </a>

          <a href="/login" className="hover:text-blue-600">
            Log in
          </a>
        </div>
      </nav>

      <section className="flex flex-col items-center justify-center text-center px-6 py-32">
        <p className="text-blue-600 font-semibold mb-4">
          AI-Powered Marketplace Listing
        </p>

        <h2 className="text-5xl font-bold mb-6">
          List Once. Sell Everywhere.
        </h2>

        <p className="max-w-2xl text-lg text-gray-600 mb-8">
          ListNexus helps online sellers create product listings with AI and
          manage those listings across multiple marketplaces from one place.
        </p>

        <button className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700">
          Get Started
        </button>
      </section>

      <section
        id="features"
        className="bg-white px-10 py-20"
      >
        <h2 className="text-3xl font-bold text-center mb-12">
          What ListNexus Does
        </h2>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="border rounded-xl p-6 text-center">
            <div className="text-4xl mb-4">🤖</div>

            <h3 className="text-xl font-semibold mb-3">
              AI-Assisted Listings
            </h3>

            <p className="text-gray-600">
              Use AI to help generate product titles, descriptions, categories,
              and listing information.
            </p>
          </div>

          <div className="border rounded-xl p-6 text-center">
            <div className="text-4xl mb-4">🌐</div>

            <h3 className="text-xl font-semibold mb-3">
              Multiple Marketplaces
            </h3>

            <p className="text-gray-600">
              Create one listing and publish it to multiple supported selling
              platforms.
            </p>
          </div>

          <div className="border rounded-xl p-6 text-center">
            <div className="text-4xl mb-4">📦</div>

            <h3 className="text-xl font-semibold mb-3">
              Centralized Inventory
            </h3>

            <p className="text-gray-600">
              Keep track of products and marketplace listings from one
              centralized system.
            </p>
          </div>
        </div>
      </section>

      <section
        id="about"
        className="px-6 py-20 text-center"
      >
        <h2 className="text-3xl font-bold mb-6">
          One Product. One Listing.
        </h2>

        <p className="max-w-2xl mx-auto text-gray-600">
          Our goal is to reduce the repetitive work involved in selling online
          while helping sellers keep their marketplace listings and inventory
          organized.
        </p>
      </section>

      <footer className="bg-gray-900 text-gray-400 text-center py-8">
        <p>ListNexus</p>
        <p className="text-sm mt-2">
          CSCI 4390 Senior Project
        </p>
      </footer>
    </main>
  );
}