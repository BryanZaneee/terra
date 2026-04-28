import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import {
  AlertTriangle,
  Camera,
  CheckCircle,
  Cloud,
  ExternalLink,
  FileArchive,
  FolderOpen,
  Image as ImageIcon,
  ShieldCheck,
  X,
} from 'lucide-react';

const PROVIDERS = [
  {
    id: 'icloud_photos',
    name: 'Apple Photos / iCloud',
    shortName: 'Apple',
    icon: Cloud,
    accent: 'text-sky-300',
    summary: 'Import from a Photos export folder, iCloud download folder, or ZIP.',
    availability: 'Apple does not provide a public full-library iCloud Photos OAuth import for Terra. Use Apple Photos export or iCloud download first, then import the local files here.',
    steps: [
      'Open Photos on macOS and export originals, or download from iCloud using Apple\'s official flow.',
      'Keep the exported folder or ZIP together; Terra will skip metadata sidecars and import supported media.',
      'Choose the folder or ZIP below and Terra will copy the media into your managed library.',
    ],
    links: [
      { label: 'Apple download instructions', url: 'https://support.apple.com/en-us/111762' },
      { label: 'Apple Data & Privacy', url: 'https://privacy.apple.com/' },
    ],
  },
  {
    id: 'google_photos',
    name: 'Google Photos',
    shortName: 'Google',
    icon: ImageIcon,
    accent: 'text-emerald-300',
    summary: 'Import a Google Takeout folder or ZIP.',
    availability: 'Google no longer offers a simple full-library Photos API import path for general apps. Google Photos Picker is useful for selected items later; full-library migration should use Takeout.',
    steps: [
      'Open Google Takeout and export Google Photos.',
      'Download the Takeout ZIP or unzip it locally.',
      'Choose the ZIP or the unzipped Takeout folder below.',
    ],
    links: [
      { label: 'Open Google Takeout', url: 'https://takeout.google.com/settings/takeout' },
      { label: 'Google export help', url: 'https://support.google.com/accounts/answer/3024190' },
    ],
  },
  {
    id: 'snapchat',
    name: 'Snapchat',
    shortName: 'Snapchat',
    icon: Camera,
    accent: 'text-yellow-300',
    summary: 'Import a Snapchat My Data archive folder or ZIP.',
    availability: 'Snapchat does not provide a public Memories bulk-import API for Terra. The supported route is a local My Data export.',
    steps: [
      'Request your data from Snapchat and include Memories/media in the export.',
      'Download the ZIP when Snapchat emails it to you.',
      'Choose the ZIP or extracted folder below.',
    ],
    links: [
      { label: 'Download Snapchat data', url: 'https://accounts.snapchat.com/accounts/downloadmydata' },
      { label: 'Snapchat data help', url: 'https://help.snapchat.com/hc/en-us/articles/7012305371156-How-do-I-download-my-data-from-Snapchat' },
    ],
  },
  {
    id: 'local_export',
    name: 'Other Local Export',
    shortName: 'Local',
    icon: FolderOpen,
    accent: 'text-white/80',
    summary: 'Import any folder or ZIP containing supported media files.',
    availability: 'Use this for Dropbox, Drive, camera-card dumps, or any other local export where the media files are already on disk.',
    steps: [
      'Download or copy the export to this Mac.',
      'Choose the folder or ZIP below.',
      'Terra will dedupe by content hash and copy supported media into the managed library.',
    ],
    links: [],
  },
];

const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider]));

const ImportWizard = ({ isOpen, onClose, initialProviderId = 'google_photos', onImportComplete }) => {
  const [activeProviderId, setActiveProviderId] = useState(initialProviderId);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const activeProvider = useMemo(
    () => PROVIDER_BY_ID[activeProviderId] || PROVIDERS[0],
    [activeProviderId]
  );
  const ActiveIcon = activeProvider.icon;

  useEffect(() => {
    if (initialProviderId && PROVIDER_BY_ID[initialProviderId]) {
      setActiveProviderId(initialProviderId);
    }
  }, [initialProviderId]);

  useEffect(() => {
    if (!isOpen) return;
    let unlisten;
    listen('provider_import_progress', (event) => {
      setProgress(event.payload);
    }).then((unsubscribe) => {
      unlisten = unsubscribe;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChooseSource = async (kind) => {
    setError(null);
    setResult(null);
    setProgress(null);

    const selected = await open(
      kind === 'folder'
        ? { directory: true, multiple: false }
        : {
            multiple: false,
            filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
          }
    );

    const sourcePath = Array.isArray(selected) ? selected[0] : selected;
    if (!sourcePath) return;

    setImporting(true);
    try {
      const summary = await invoke('import_provider_export', {
        providerId: activeProvider.id,
        sourcePath,
      });
      setResult(summary);
      onImportComplete?.(summary);
    } catch (err) {
      const message = typeof err === 'string' ? err : err?.message ?? 'Import failed';
      setError(message);
    } finally {
      setImporting(false);
    }
  };

  const progressPercent = progress?.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#161616] border border-white/10 rounded-xl w-full max-w-4xl max-h-[88vh] shadow-2xl overflow-hidden flex">
        <aside className="w-64 border-r border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-white">Import</h3>
              <p className="text-xs text-white/40 font-mono mt-0.5">LOCAL-FIRST</p>
            </div>
          </div>

          <div className="space-y-1">
            {PROVIDERS.map((provider) => {
              const Icon = provider.icon;
              const active = provider.id === activeProvider.id;
              return (
                <button
                  key={provider.id}
                  onClick={() => {
                    setActiveProviderId(provider.id);
                    setError(null);
                    setResult(null);
                    setProgress(null);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${
                    active
                      ? 'bg-white/10 text-white border border-white/10'
                      : 'text-white/60 hover:bg-white/5 hover:text-white border border-transparent'
                  }`}
                >
                  <Icon size={17} className={active ? provider.accent : 'text-white/40'} />
                  <span className="truncate">{provider.name}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col">
          <header className="flex items-center justify-between p-6 border-b border-white/10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <ActiveIcon size={20} className={activeProvider.accent} />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-white truncate">{activeProvider.name}</h2>
                <p className="text-sm text-white/50 truncate">{activeProvider.summary}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              aria-label="Close import wizard"
            >
              <X size={20} />
            </button>
          </header>

          <div className="p-6 overflow-y-auto space-y-6">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-sky-500/10 border border-sky-400/20">
              <ShieldCheck size={18} className="text-sky-300 shrink-0 mt-0.5" />
              <p className="text-sm text-sky-100/80 leading-6">{activeProvider.availability}</p>
            </div>

            <div>
              <div className="text-xs font-mono text-white/30 uppercase tracking-widest mb-3">Steps</div>
              <ol className="space-y-2">
                {activeProvider.steps.map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm text-white/70 leading-6">
                    <span className="w-6 h-6 rounded-full bg-white/10 text-white/60 flex items-center justify-center text-xs font-mono shrink-0">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {activeProvider.links.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {activeProvider.links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-sm text-white/70 hover:text-white transition-colors"
                  >
                    <ExternalLink size={15} />
                    {link.label}
                  </a>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => handleChooseSource('folder')}
                disabled={importing}
                className="flex items-center justify-center gap-3 px-4 py-3 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 hover:border-emerald-400/50 text-emerald-100 transition-colors disabled:opacity-50"
              >
                <FolderOpen size={18} />
                Choose Folder
              </button>
              <button
                onClick={() => handleChooseSource('zip')}
                disabled={importing}
                className="flex items-center justify-center gap-3 px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/80 transition-colors disabled:opacity-50"
              >
                <FileArchive size={18} />
                Choose ZIP
              </button>
            </div>

            {importing && (
              <div className="space-y-2 p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between text-xs font-mono text-white/50">
                  <span>{progress?.phase === 'complete' ? 'Complete' : 'Importing'}</span>
                  <span>{progress?.processed ?? 0} / {progress?.total ?? '?'}</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {result && !importing && (
              <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-400/20">
                <div className="flex items-center gap-2 text-emerald-200 font-medium">
                  <CheckCircle size={18} />
                  Import complete
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
                  <ImportStat label="Imported" value={result.imported} />
                  <ImportStat label="Duplicates" value={result.skipped_duplicates} />
                  <ImportStat label="Unsupported" value={result.unsupported} />
                  <ImportStat label="Failed" value={result.failed} />
                  <ImportStat label="Found" value={result.discovered} />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-4 rounded-lg bg-red-500/10 border border-red-400/20 text-sm text-red-200">
                <AlertTriangle size={17} className="shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const ImportStat = ({ label, value }) => (
  <div className="rounded-lg bg-black/20 border border-white/10 p-2">
    <div className="text-white/90 text-sm">{value ?? 0}</div>
    <div className="text-white/35">{label}</div>
  </div>
);

export default ImportWizard;
