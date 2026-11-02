import Image from "next/image";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { LEAGUES } from "@/lib/leagues";
import { SITE } from "@/lib/site";

// All the words on this page come from src/lib/site.ts. The competitions come from src/lib/leagues.ts,
// so the list always matches what the bot and the dashboard really support.

const TEMPLATE_VISUALS = ["photo", "frame", "panel", "stripe"] as const;

export default async function Home() {
  const user = await getCurrentUser();
  const [mainExample, flankLeft, flankRight] = SITE.examples;
  const classicExample = SITE.examples[1];
  const brandCaps = SITE.name.toUpperCase();

  const primaryCta = user ? (
    <Link className="btn" href="/dashboard">
      Go to Dashboard
    </Link>
  ) : (
    <Link className="btn" href="/signup">
      Create account
    </Link>
  );

  return (
    <div className="landing-root">
      <div className="landing-main">
        {/* 1. Hero */}
        <section className="container hero-editorial" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="hero-eyebrow-wrap">
              <span className="hero-indicator" aria-hidden="true" />
              <p className="eyebrow">{SITE.hero.eyebrow}</p>
            </div>
            <h1 id="hero-title" className="display hero-display">
              {SITE.hero.headline[0]}
              <br />
              <em>{SITE.hero.headline[1]}</em>
            </h1>
            <p className="hero-sub">{SITE.hero.intro}</p>
            <div className="hero-actions">
              {primaryCta}
              <a className="btn ghost" href="#how">
                {SITE.hero.more} ↓
              </a>
            </div>
            <p className="hero-fineprint">{SITE.hero.fineprint}</p>
          </div>

          <div className="hero-stage">
            <div className="hero-stage-backdrop" aria-hidden="true">
              <div className="hero-flank hero-flank-left">
                <Image src={flankRight.src} alt="" width={720} height={900} className="hero-flank-img" />
              </div>
              <div className="hero-flank hero-flank-right">
                <Image src={flankLeft.src} alt="" width={720} height={900} className="hero-flank-img" />
              </div>
            </div>

            <div className="hero-focal-card">
              <div className="hero-image-frame">
                <Image src={mainExample.src} alt={mainExample.alt} width={720} height={900} priority className="hero-poster" />
              </div>

              <div className="hero-telegram-mockup" role="img" aria-label={SITE.mockup.label}>
                <div className="mockup-header">
                  <div className="mockup-bot-meta">
                    <span className="mockup-avatar" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </span>
                    <div>
                      <span className="mockup-bot-name">{SITE.mockup.bot}</span>
                      <span className="mockup-bot-badge">{SITE.mockup.label}</span>
                    </div>
                  </div>
                  <span className="mockup-status-pill">{SITE.mockup.status}</span>
                </div>
                <div className="mockup-body">
                  <div className="mockup-file-row">
                    <span className="mockup-file-icon" aria-hidden="true">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </span>
                    <div className="mockup-file-details">
                      <span className="mockup-file-name">{SITE.mockup.file}</span>
                      <span className="mockup-file-meta">{SITE.mockup.meta}</span>
                    </div>
                  </div>
                  <p className="mockup-caption">{SITE.mockup.caption}</p>
                  <span className="mockup-note">{SITE.mockup.note}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Competitions */}
        <section className="coverage-strip" aria-labelledby="coverage-heading">
          <div className="container coverage-inner">
            <p id="coverage-heading" className="coverage-label">
              {SITE.coverageLabel}
            </p>
            <ul className="coverage-list" role="list">
              {LEAGUES.map((l) => (
                <li key={l.id} className="coverage-item">
                  <span className="coverage-dot" aria-hidden="true" />
                  {l.name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 3. Steps */}
        <section id="how" className="container section-editorial" aria-labelledby="how-heading">
          <div className="section-head">
            <h2 id="how-heading" className="section-title">
              {SITE.steps.title}
            </h2>
            <p className="section-lead">{SITE.steps.lead}</p>
          </div>
          <div className="pipeline-grid">
            {SITE.steps.items.map((step, i) => (
              <article key={step.title} className="pipeline-card">
                <div className="pipeline-top">
                  <span className="pipeline-num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="pipeline-tag">{step.tag}</span>
                </div>
                <h3 className="pipeline-title">{step.title}</h3>
                <p className="pipeline-desc">{step.text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* 4. Templates */}
        <section id="templates" className="container section-editorial" aria-labelledby="templates-heading">
          <div className="section-head">
            <h2 id="templates-heading" className="section-title">
              {SITE.templates.title}
            </h2>
            <p className="section-lead">{SITE.templates.lead}</p>
          </div>

          <div className="templates-grid">
            {SITE.templates.items.map((tpl, i) => {
              const visual = TEMPLATE_VISUALS[i];
              return (
                <article key={tpl.key} className="template-card">
                  <div className="template-visual-preview" aria-hidden="true">
                    <span className={`tpl-preview-tag ${visual === "photo" ? "tpl-tag-rendered" : "tpl-tag-schematic"}`}>
                      {visual === "photo" ? SITE.templates.realLabel : SITE.templates.sketchLabel}
                    </span>
                    {visual === "photo" && (
                      <div className="tpl-visual-photo">
                        <Image src={classicExample.src} alt="" width={360} height={450} className="tpl-thumb-img" />
                      </div>
                    )}
                    {visual === "frame" && (
                      <div className="tpl-visual-frame">
                        <div className="frame-border-mock">
                          <span className="frame-brand-mock">{brandCaps}</span>
                          <div className="frame-score-mock">2 – 1</div>
                          <div className="frame-teams-mock">
                            <span>FC ALPHA</span>
                            <span>FC BETA</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {visual === "panel" && (
                      <div className="tpl-visual-panel">
                        <div className="panel-photo-half" />
                        <div className="panel-block-half">
                          <span className="panel-divider" />
                          <div className="panel-score-mock">3 – 0</div>
                          <div className="panel-teams-mock">
                            <span>ALPHA</span>
                            <span>BETA</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {visual === "stripe" && (
                      <div className="tpl-visual-stripe">
                        <div className="stripe-band-mock">
                          <div className="stripe-score-mock">1 – 0</div>
                        </div>
                      </div>
                    )}
                  </div>

                  <h3 className="template-name">{tpl.name}</h3>
                  <p className="template-tagline">{tpl.tagline}</p>
                  <p className="template-description">{tpl.text}</p>
                  <div className="template-footer">
                    <span className="template-meta-label">{SITE.templates.layoutLabel}</span>
                    <span className="template-meta-val">{tpl.layout}</span>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="section-lead templates-own">{SITE.templates.own}</p>
        </section>

        {/* 5. Features */}
        <section id="features" className="container section-editorial" aria-labelledby="features-heading">
          <div className="section-head">
            <h2 id="features-heading" className="section-title">
              {SITE.features.title}
            </h2>
            <p className="section-lead">{SITE.features.lead}</p>
          </div>
          <div className="specs-grid">
            {SITE.features.items.map((f) => (
              <div key={f.metric} className="spec-card">
                <span className="spec-metric">{f.metric}</span>
                <h3 className="spec-label">{f.label}</h3>
                <p className="spec-desc">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 6. FAQ */}
        <section id="faq" className="container section-editorial faq-layout" aria-labelledby="faq-heading">
          <div className="faq-intro">
            <h2 id="faq-heading" className="section-title">
              {SITE.faqTitle}
            </h2>
            <p className="section-lead">{SITE.faqLead}</p>
            <div className="faq-prompt-card">
              <strong>{user ? SITE.faqPrompt.userTitle : SITE.faqPrompt.guestTitle}</strong>
              <p>{user ? SITE.faqPrompt.userText : SITE.faqPrompt.guestText}</p>
              {user ? (
                <Link className="btn sm" href="/dashboard">
                  Go to Dashboard
                </Link>
              ) : (
                <Link className="btn sm" href="/signup">
                  Create account
                </Link>
              )}
            </div>
          </div>
          <div className="faq-accordion-wrap">
            {SITE.faq.map((item) => (
              <details key={item.q} className="faq-item">
                <summary className="faq-question">
                  <span>{item.q}</span>
                </summary>
                <div className="faq-answer">
                  <p>{item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* 7. Final call to action */}
        <section className="container section-editorial cta-section">
          <div className="cta-editorial">
            <h2 className="section-title cta-title">{SITE.cta.title}</h2>
            <p className="cta-sub">{SITE.cta.text}</p>
            <div className="cta-actions">
              {user ? (
                <Link className="btn light" href="/dashboard">
                  Go to Dashboard
                </Link>
              ) : (
                <>
                  <Link className="btn light" href="/signup">
                    Create account
                  </Link>
                  <Link className="btn ghost light-ghost" href="/login">
                    Log in
                  </Link>
                </>
              )}
            </div>
            <p className="cta-fineprint">{SITE.cta.fineprint}</p>
          </div>
        </section>
      </div>

      {/* 8. Footer */}
      <footer className="container foot-editorial">
        <div className="foot-brand">
          <span className="foot-logo">{SITE.name}</span>
          <span className="foot-copy">{SITE.footer.tagline}</span>
        </div>
        <nav className="foot-nav" aria-label="Footer navigation">
          {SITE.nav.map((n) => (
            <a key={n.href} href={n.href}>
              {n.label}
            </a>
          ))}
          {user ? (
            <Link href="/dashboard">Dashboard</Link>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Create account</Link>
            </>
          )}
        </nav>
        <div className="foot-meta">
          <span>{SITE.footer.meta}</span>
          <span>© {SITE.name}</span>
        </div>
      </footer>
    </div>
  );
}
