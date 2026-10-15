import Image from "next/image";
import { SITE } from "@/lib/site";

export default function Home() {
  return (
    <>
      <section className="container hero">
        <div className="hero-copy">
          <p className="eyebrow">{SITE.eyebrow}</p>
          <h1 className="display">
            {SITE.headline[0]}
            <br />
            <em>{SITE.headline[1]}</em>
          </h1>
          <p className="sub">{SITE.intro}</p>
          <div className="actions">
            <a className="btn" href="/signup">
              Create an account
            </a>
            <a className="btn ghost" href="#how">
              See how it works
            </a>
          </div>
          <p className="fineprint">{SITE.fineprint}</p>
        </div>
        <div className="posts">
          {SITE.examples.map((ex) => (
            <Image key={ex.src} src={ex.src} alt={ex.alt} width={720} height={900} priority />
          ))}
        </div>
      </section>

      <section id="how" className="container section">
        <h2 className="section-title">{SITE.stepsTitle}</h2>
        <div className="steps">
          {SITE.steps.map((s, i) => (
            <div className="step" key={s.title}>
              <div className="n">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container section split">
        <div>
          <p className="eyebrow">{SITE.templates.eyebrow}</p>
          <h2 className="section-title" style={{ marginTop: 16 }}>
            {SITE.templates.title}
          </h2>
          <p className="lead">{SITE.templates.text}</p>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <strong>Choose a template</strong>
          <div className="tpl-chips">
            <span className="chip on">Classic</span>
            <span className="chip soon">+ Add your own (soon)</span>
          </div>
        </div>
      </section>

      <section className="container section faq">
        <h2 className="section-title">{SITE.faqTitle}</h2>
        <div className="faq-list">
          {SITE.faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="container section">
        <div className="cta">
          <h2 className="section-title">{SITE.cta}</h2>
          <a className="btn light" href="/signup">
            Create an account
          </a>
        </div>
      </section>

      <footer className="container foot">
        <span>© {SITE.name}</span>
        <span>Demo build for testing</span>
      </footer>
    </>
  );
}
