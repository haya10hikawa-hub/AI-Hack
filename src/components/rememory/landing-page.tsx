import Link from "next/link";
import { ArrowRight, ImagePlus, Search, ShieldCheck } from "lucide-react";

import { Brand } from "./brand";

export function LandingPage() {
  return (
    <main className="landing-page" id="main-content">
      <header className="landing-header">
        <Brand />
        <nav aria-label="アカウント">
          <Link className="button button--quiet" href="/auth/login">
            ログイン
          </Link>
          <Link className="button button--primary" href="/auth/sign-up">
            はじめる
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero__copy">
          <p className="eyebrow">Evidence-backed personal memory</p>
          <h1>
            思い出は、
            <br />
            つながるほど鮮やかになる。
          </h1>
          <p>
            写真に残った確かな手がかりと、あなた自身の確認からMemoryをつくる。AIが分からないことは、分からないまま丁寧に残します。
          </p>
          <div className="landing-hero__actions">
            <Link className="button button--primary" href="/auth/sign-up">
              自分のMemoryをはじめる
              <ArrowRight aria-hidden="true" size={19} />
            </Link>
            <Link className="text-link" href="#how-it-works">
              仕組みを見る
            </Link>
          </div>
        </div>
        <div
          className="landing-thread"
          aria-label="Re:Memoryの記憶形成プロセス"
        >
          <article>
            <span
              className="thread-node thread-node--filled"
              aria-hidden="true"
            />
            <small>Evidence</small>
            <strong>写真と撮影日時</strong>
            <p>まず、確認できる事実を集めます。</p>
          </article>
          <span
            className="landing-thread__line landing-thread__line--dotted"
            aria-hidden="true"
          />
          <article>
            <span
              className="thread-node thread-node--open"
              aria-hidden="true"
            />
            <small>AI inference</small>
            <strong>文脈の候補</strong>
            <p>推定は未確認として、点線で区別します。</p>
          </article>
          <span className="landing-thread__line" aria-hidden="true" />
          <article>
            <span
              className="thread-node thread-node--filled"
              aria-hidden="true"
            />
            <small>User confirmed</small>
            <strong>あなたのMemory</strong>
            <p>確認された内容だけが、確かな文脈になります。</p>
          </article>
        </div>
      </section>

      <section
        className="landing-how"
        id="how-it-works"
        aria-labelledby="how-title"
      >
        <div className="landing-section-heading">
          <p className="eyebrow">How it works</p>
          <h2 id="how-title">
            AIが埋めるのではなく、
            <br />
            一緒に記憶をほどいていく。
          </h2>
        </div>
        <ol>
          <li>
            <ImagePlus aria-hidden="true" size={25} />
            <span>
              <strong>写真を追加</strong>
              <p>
                撮影日時などの確かな情報から、出来事のまとまりをつくります。
              </p>
            </span>
          </li>
          <li>
            <span
              className="thread-node thread-node--open"
              aria-hidden="true"
            />
            <span>
              <strong>分からないことは未確認に</strong>
              <p>AIの観察と推定を、Evidenceや事実と混ぜません。</p>
            </span>
          </li>
          <li>
            <Search aria-hidden="true" size={25} />
            <span>
              <strong>曖昧な言葉で思い出す</strong>
              <p>
                候補が複数あるときは決め打ちせず、一致した理由と一緒に示します。
              </p>
            </span>
          </li>
        </ol>
      </section>

      <section className="landing-trust" aria-labelledby="trust-title">
        <ShieldCheck aria-hidden="true" size={34} />
        <div>
          <p className="eyebrow">Private by design</p>
          <h2 id="trust-title">個人的な写真だから、静かに守る。</h2>
        </div>
        <p>
          写真は非公開。正確なGPSや不要なEXIFは外部AIへ送らず、回答はEvidenceまたはあなたの確認まで辿れる形でつくります。
        </p>
      </section>

      <footer className="landing-footer">
        <Brand compact />
        <p>写真と確かな根拠から、あとで辿れる記憶へ。</p>
        <Link className="button button--secondary" href="/auth/sign-up">
          Re:Memoryをはじめる
        </Link>
      </footer>
    </main>
  );
}
