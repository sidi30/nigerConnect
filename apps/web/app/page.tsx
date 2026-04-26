import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Context } from "@/components/Context";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { Community } from "@/components/Community";
import { Security } from "@/components/Security";
import { FAQ } from "@/components/FAQ";
import { Download } from "@/components/Download";
import { Footer } from "@/components/Footer";

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Context />
        <Features />
        <HowItWorks />
        <Community />
        <Security />
        <FAQ />
        <Download />
      </main>
      <Footer />
    </>
  );
}
