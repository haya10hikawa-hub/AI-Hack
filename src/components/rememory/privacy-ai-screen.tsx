"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  CalendarDays,
  Clock3,
  Image as ImageIcon,
  LoaderCircle,
  LogOut,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react";

import { apiRequest, jsonBody } from "./api-client";
import { AppShell } from "./app-shell";
import { InlineNotice, StateView } from "./state-view";
import type { PrivacyAiSettings } from "./types";
import { useApiResource } from "./use-api-resource";

type BooleanSetting = Exclude<
  {
    [Key in keyof PrivacyAiSettings]: PrivacyAiSettings[Key] extends boolean
      ? Key
      : never;
  }[keyof PrivacyAiSettings],
  undefined
>;

interface ToggleRowProps {
  id: BooleanSetting;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  icon: typeof ImageIcon;
  onChange: (key: BooleanSetting, value: boolean) => void;
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  icon: Icon,
  onChange,
}: ToggleRowProps) {
  return (
    <div className="setting-row">
      <Icon aria-hidden="true" size={21} strokeWidth={1.7} />
      <label htmlFor={id}>
        <strong>{label}</strong>
        <span>{description}</span>
      </label>
      <button
        id={id}
        className={checked ? "switch is-on" : "switch"}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(id, !checked)}
      >
        <span />
      </button>
    </div>
  );
}

export function PrivacyAiScreen() {
  const router = useRouter();
  const resource = useApiResource<PrivacyAiSettings>(
    "/api/settings/privacy-ai",
  );
  const [savedOverride, setSavedOverride] = useState<PrivacyAiSettings | null>(
    null,
  );
  const [savingKey, setSavingKey] = useState<BooleanSetting | null>(null);
  const [message, setMessage] = useState<{
    tone: "sage" | "error";
    text: string;
  } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const settings = savedOverride ?? resource.data;

  const updateSetting = async (key: BooleanSetting, value: boolean) => {
    if (!settings) return;
    setSavingKey(key);
    setMessage(null);
    try {
      const updated = await apiRequest<PrivacyAiSettings>(
        "/api/settings/privacy-ai",
        {
          method: "PATCH",
          ...jsonBody({ [key]: value }),
        },
      );
      setSavedOverride(updated);
      setMessage({ tone: "sage", text: "設定を保存しました。" });
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "設定を保存できませんでした。",
      });
    } finally {
      setSavingKey(null);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    setMessage(null);
    try {
      await apiRequest("/api/auth/sign-out", { method: "POST" });
      router.replace("/auth/login");
      router.refresh();
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "ログアウトできませんでした。",
      });
      setSigningOut(false);
    }
  };

  return (
    <AppShell>
      <div className="page-shell page-shell--settings">
        <header className="page-intro">
          <div>
            <p className="eyebrow">Settings</p>
            <h1>Privacy & AI</h1>
            <p>
              Memoryのために何を使うかは、あなたが決められます。変更はこれからの処理に反映されます。
            </p>
          </div>
        </header>

        <div className="privacy-principle">
          <ShieldCheck aria-hidden="true" size={25} />
          <div>
            <strong>写真は非公開です</strong>
            <p>
              AIにはリサイズして不要なメタデータを除いた画像だけを送ります。正確なGPSは送りません。
            </p>
          </div>
        </div>

        {resource.loading ? (
          <StateView
            kind="loading"
            title="プライバシー設定を読み込んでいます"
            description="現在の選択を安全に取得しています。"
          />
        ) : resource.error ? (
          <StateView
            kind={resource.error.code === "NETWORK_ERROR" ? "offline" : "error"}
            title="設定を読み込めませんでした"
            description={resource.error.message}
            action={
              <button
                className="button button--secondary"
                type="button"
                onClick={resource.reload}
              >
                もう一度読み込む
              </button>
            }
          />
        ) : settings ? (
          <div className="settings-sections">
            {message ? (
              <InlineNotice tone={message.tone}>{message.text}</InlineNotice>
            ) : null}
            <section
              className="settings-group"
              aria-labelledby="source-settings-title"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Sources</p>
                  <h2 id="source-settings-title">Memoryに使う情報</h2>
                </div>
              </div>
              <ToggleRow
                id="usePhotos"
                label="写真をAI解析に使う"
                description="メタデータを除いた縮小画像を使います"
                checked={settings.usePhotos}
                disabled={savingKey !== null}
                icon={ImageIcon}
                onChange={updateSetting}
              />
              <ToggleRow
                id="useCapturedAt"
                label="撮影日時を使う"
                description="写真を時間順の出来事へまとめるために使います"
                checked={settings.useCapturedAt}
                disabled={savingKey !== null}
                icon={Clock3}
                onChange={updateSetting}
              />
              <ToggleRow
                id="useLocation"
                label="おおまかな場所を使う"
                description="正確な座標ではなく、市区町村など粗い情報だけを使います"
                checked={settings.useLocation}
                disabled={savingKey !== null}
                icon={MapPin}
                onChange={updateSetting}
              />
              <div className="connection-state">
                <span>位置情報の状態</span>
                <strong>
                  {settings.locationPermissionState === "granted"
                    ? "利用を許可"
                    : settings.locationPermissionState === "denied"
                      ? "利用しない"
                      : settings.locationPermissionState === "prompt"
                        ? "未選択"
                        : "利用できません"}
                </strong>
              </div>
              <ToggleRow
                id="useCalendar"
                label="カレンダー情報を使う"
                description="接続済みの場合のみ、出来事の文脈候補として使います"
                checked={settings.useCalendar}
                disabled={
                  savingKey !== null ||
                  settings.calendarConnectionState !== "connected"
                }
                icon={CalendarDays}
                onChange={updateSetting}
              />
              <div className="connection-state">
                <span>カレンダー接続</span>
                <strong>
                  {settings.calendarConnectionState === "connected"
                    ? "接続済み"
                    : settings.calendarConnectionState === "not_connected"
                      ? "未接続"
                      : "利用できません"}
                </strong>
              </div>
            </section>

            <section
              className="settings-group"
              aria-labelledby="learning-settings-title"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Learning</p>
                  <h2 id="learning-settings-title">あなたの文脈</h2>
                </div>
              </div>
              <ToggleRow
                id="usePersonalContext"
                label="確認済みの文脈を使う"
                description="あなたが明示的に確認した呼び方や関係だけを使います"
                checked={settings.usePersonalContext}
                disabled={savingKey !== null}
                icon={Brain}
                onChange={updateSetting}
              />
              <ToggleRow
                id="searchLearning"
                label="検索学習（準備中）"
                description="現在は保存だけ行い、検索結果にはまだ利用しません"
                checked={settings.searchLearning}
                disabled
                icon={Search}
                onChange={updateSetting}
              />
            </section>

            {savingKey ? (
              <p className="saving-indicator" role="status">
                <LoaderCircle className="spin" aria-hidden="true" size={17} />
                設定を保存しています…
              </p>
            ) : null}
            <section
              className="account-actions"
              aria-labelledby="account-actions-title"
            >
              <div>
                <p className="eyebrow">Account</p>
                <h2 id="account-actions-title">アカウント</h2>
                <p>この端末のRe:Memoryセッションを終了します。</p>
              </div>
              <button
                className="button button--secondary"
                type="button"
                disabled={signingOut}
                onClick={() => void signOut()}
              >
                {signingOut ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={18} />
                ) : (
                  <LogOut aria-hidden="true" size={18} />
                )}
                {signingOut ? "ログアウト中…" : "ログアウト"}
              </button>
            </section>
          </div>
        ) : (
          <StateView
            kind="empty"
            title="設定がありません"
            description="利用できるプライバシー設定を取得できませんでした。"
          />
        )}
      </div>
    </AppShell>
  );
}
