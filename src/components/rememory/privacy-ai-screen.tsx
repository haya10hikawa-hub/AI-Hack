"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  CalendarDays,
  Clock3,
  Download,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  LogOut,
  MapPin,
  Map,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";

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
  const [exporting, setExporting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [clearingMap, setClearingMap] = useState(false);

  const settings = savedOverride ?? resource.data;
  const unauthenticated = resource.error?.status === 401;

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

  const exportAccount = async () => {
    setExporting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account/export", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("データを書き出せませんでした。");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `rememory-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage({
        tone: "sage",
        text: "データを書き出しました。写真のリンクは1時間だけ有効です。",
      });
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "データを書き出せませんでした。",
      });
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeletingAccount(true);
    setMessage(null);
    try {
      await apiRequest("/api/account/delete", {
        method: "POST",
        ...jsonBody({ confirmation: deleteConfirmation }),
      });
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "アカウントを削除できませんでした。",
      });
      setDeletingAccount(false);
    }
  };

  const clearMap = async () => {
    setClearingMap(true);
    setMessage(null);
    try {
      await apiRequest("/api/map", { method: "DELETE" });
      setMessage({
        tone: "sage",
        text: "探索した地図を消去しました。Memoryは削除していません。",
      });
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "地図を消去できませんでした。",
      });
    } finally {
      setClearingMap(false);
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
        ) : resource.error && !unauthenticated ? (
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
        ) : unauthenticated ? (
          <StateView
            kind="empty"
            title="公開プレビューでは個人設定は保存されません"
            description="ログインなしで画面を確認できます。アカウント作成後、写真・AI・地図・検索学習の設定を自分用に保存できます。"
            action={
              <Link className="button button--primary" href="/auth/sign-up">
                アカウントを作成
              </Link>
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
                id="memoryMap"
                label="Memory Map"
                description="アプリを開いている間だけ、端末内で現在地を粗い地域セルへ変換できます"
                checked={settings.memoryMap}
                disabled={savingKey !== null}
                icon={Map}
                onChange={updateSetting}
              />
              <div className="map-settings-action">
                <div>
                  <strong>探索した地図を消去</strong>
                  <span>
                    地図の地域セルだけを削除します。Memoryや写真は残ります。
                  </span>
                </div>
                <button
                  className="button button--quiet button--danger-text"
                  type="button"
                  disabled={clearingMap}
                  onClick={() => void clearMap()}
                >
                  {clearingMap ? "消去中…" : "地図だけ消去"}
                </button>
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
                label="検索結果をあなた向けに学習"
                description="役に立った・違ったと明示した結果だけを、同じ検索の並び替えに使います。オフにすると履歴を削除します"
                checked={settings.searchLearning}
                disabled={savingKey !== null}
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
              <div className="account-actions__intro">
                <p className="eyebrow">Account</p>
                <h2 id="account-actions-title">アカウント</h2>
                <p>
                  パスワード、データの持ち出し、完全削除をここから管理できます。
                </p>
              </div>
              <div className="account-action-grid">
                <Link
                  className="button button--secondary"
                  href="/auth/reset-password"
                >
                  <KeyRound aria-hidden="true" size={18} />
                  パスワードを変更
                </Link>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={exporting}
                  onClick={() => void exportAccount()}
                >
                  {exporting ? (
                    <LoaderCircle
                      className="spin"
                      aria-hidden="true"
                      size={18}
                    />
                  ) : (
                    <Download aria-hidden="true" size={18} />
                  )}
                  {exporting ? "書き出し中…" : "データを書き出す"}
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={signingOut}
                  onClick={() => void signOut()}
                >
                  {signingOut ? (
                    <LoaderCircle
                      className="spin"
                      aria-hidden="true"
                      size={18}
                    />
                  ) : (
                    <LogOut aria-hidden="true" size={18} />
                  )}
                  {signingOut ? "ログアウト中…" : "ログアウト"}
                </button>
              </div>
              <div className="danger-zone">
                <div>
                  <strong>アカウントを完全に削除</strong>
                  <p>
                    すべてのMemory、Evidence、元画像を削除します。元に戻せません。
                  </p>
                </div>
                <label htmlFor="delete-confirmation">
                  続ける場合は「削除」と入力
                </label>
                <input
                  className="text-input"
                  id="delete-confirmation"
                  value={deleteConfirmation}
                  onChange={(event) =>
                    setDeleteConfirmation(event.target.value)
                  }
                  autoComplete="off"
                />
                <button
                  className="button button--danger"
                  type="button"
                  disabled={deleteConfirmation !== "削除" || deletingAccount}
                  onClick={() => void deleteAccount()}
                >
                  {deletingAccount ? (
                    <LoaderCircle
                      className="spin"
                      aria-hidden="true"
                      size={18}
                    />
                  ) : (
                    <Trash2 aria-hidden="true" size={18} />
                  )}
                  {deletingAccount ? "削除しています…" : "完全に削除"}
                </button>
              </div>
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
