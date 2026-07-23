import { Copy, ExternalLink, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  createAccountPlatform,
  removeAccountPlatform,
  updateAccountPlatform
} from "../domain/profileModel";
import { displayUrlLabel, normalizeLaunchUrl } from "../shared/urlHelpers";
import type { AccountPlatform } from "../types";

const ACCOUNT_PLATFORM_TEMPLATES: Array<{
  label: string;
  platform: string;
  loginUrl: string;
}> = [
  { label: "X", platform: "X", loginUrl: "https://x.com/i/flow/login" },
  { label: "Discord", platform: "Discord", loginUrl: "https://discord.com/login" },
  { label: "Telegram", platform: "Telegram", loginUrl: "https://web.telegram.org/" },
  { label: "Gmail", platform: "Gmail", loginUrl: "https://accounts.google.com/" },
  { label: "Galxe", platform: "Galxe", loginUrl: "https://galxe.com" },
  { label: "Zealy", platform: "Zealy", loginUrl: "https://zealy.io" }
];

interface AccountPlatformEditorProps {
  accountPlatforms: AccountPlatform[];
  onChange: (accountPlatforms: AccountPlatform[]) => void;
  onOpen?: (accountPlatform: AccountPlatform) => void;
  onCopyUsername?: (accountPlatform: AccountPlatform) => void;
}

export function AccountPlatformEditor({
  accountPlatforms,
  onChange,
  onOpen,
  onCopyUsername
}: AccountPlatformEditorProps) {
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  function addAccountPlatform() {
    const accountPlatform = createAccountPlatform(accountPlatforms);
    setExpandedIds((current) => [...current, accountPlatform.id]);
    onChange([...accountPlatforms, accountPlatform]);
  }

  function patchAccountPlatform(
    accountPlatformId: string,
    patch: Partial<AccountPlatform>
  ) {
    onChange(updateAccountPlatform(accountPlatforms, accountPlatformId, patch));
  }

  function deleteAccountPlatform(accountPlatformId: string) {
    setExpandedIds((current) => current.filter((id) => id !== accountPlatformId));
    onChange(removeAccountPlatform(accountPlatforms, accountPlatformId));
  }

  function applyAccountPlatformTemplate(
    accountPlatformId: string,
    template: (typeof ACCOUNT_PLATFORM_TEMPLATES)[number]
  ) {
    patchAccountPlatform(accountPlatformId, {
      platform: template.platform,
      loginUrl: template.loginUrl
    });
  }

  function toggleAccountPlatform(accountPlatformId: string) {
    setExpandedIds((current) =>
      current.includes(accountPlatformId)
        ? current.filter((id) => id !== accountPlatformId)
        : [...current, accountPlatformId]
    );
  }

  return (
    <section className="account-platform-section" aria-label="账号平台">
      <div className="account-platform-header">
        <span className="field-label">账号平台</span>
        <button
          className="secondary-button compact"
          type="button"
          onClick={addAccountPlatform}
        >
          <Plus size={15} />
          添加账号平台
        </button>
      </div>

      {accountPlatforms.length === 0 ? (
        <p className="empty-inline">还没有保存平台登录资料。</p>
      ) : (
        <div className="account-platform-list">
          {accountPlatforms.map((accountPlatform) => {
            const label = accountPlatform.platform || "未命名平台";
            const expanded = expandedIds.includes(accountPlatform.id);
            return (
              <article
                className={`account-platform-card ${expanded ? "expanded" : ""}`}
                key={accountPlatform.id}
              >
                <div className="account-platform-summary">
                  <div className="account-platform-title">
                    <strong>{label}</strong>
                    <span>
                      {accountPlatform.username ||
                        displayUrlLabel(accountPlatform.loginUrl) ||
                        "未填写用户名"}
                    </span>
                  </div>
                  {accountPlatform.notes ? <p>{accountPlatform.notes}</p> : null}
                  <div className="account-platform-actions">
                    {onOpen && accountPlatform.loginUrl ? (
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`打开账号平台 ${label}`}
                        onClick={() => onOpen(accountPlatform)}
                      >
                        <ExternalLink size={15} />
                      </button>
                    ) : null}
                    {onCopyUsername && accountPlatform.username ? (
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`复制用户名 ${label}`}
                        onClick={() => onCopyUsername(accountPlatform)}
                      >
                        <Copy size={15} />
                      </button>
                    ) : null}
                    <button
                      className="icon-button compact"
                      type="button"
                      aria-label={
                        expanded ? `收起账号平台 ${label}` : `编辑账号平台 ${label}`
                      }
                      onClick={() => toggleAccountPlatform(accountPlatform.id)}
                    >
                      {expanded ? <X size={15} /> : <Pencil size={15} />}
                    </button>
                    <button
                      className="icon-button compact danger"
                      type="button"
                      aria-label={`删除账号平台 ${label}`}
                      onClick={() => deleteAccountPlatform(accountPlatform.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="account-platform-expanded">
                    <div className="platform-template-row">
                      <span>常用</span>
                      {ACCOUNT_PLATFORM_TEMPLATES.map((template) => (
                        <button
                          className="platform-template-button"
                          type="button"
                          aria-label={`套用 ${template.label} 模板`}
                          key={template.label}
                          onClick={() =>
                            applyAccountPlatformTemplate(accountPlatform.id, template)
                          }
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                    <div className="account-platform-grid">
                      <div className="field">
                        <label htmlFor={`platform-name-${accountPlatform.id}`}>平台名称</label>
                        <input
                          id={`platform-name-${accountPlatform.id}`}
                          value={accountPlatform.platform}
                          placeholder="X / Galxe / Discord"
                          onChange={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              platform: event.target.value
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`platform-url-${accountPlatform.id}`}>登录网址</label>
                        <input
                          id={`platform-url-${accountPlatform.id}`}
                          value={accountPlatform.loginUrl}
                          placeholder="https://example.com/login"
                          onChange={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              loginUrl: event.target.value
                            })
                          }
                          onBlur={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              loginUrl: normalizeLaunchUrl(event.target.value)
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`platform-username-${accountPlatform.id}`}>
                          平台用户名
                        </label>
                        <input
                          id={`platform-username-${accountPlatform.id}`}
                          value={accountPlatform.username}
                          placeholder="用户名 / 邮箱"
                          onChange={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              username: event.target.value
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`platform-notes-${accountPlatform.id}`}>平台备注</label>
                        <textarea
                          id={`platform-notes-${accountPlatform.id}`}
                          rows={2}
                          value={accountPlatform.notes}
                          placeholder="用途、登录状态、注意事项"
                          onChange={(event) =>
                            patchAccountPlatform(accountPlatform.id, {
                              notes: event.target.value
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
