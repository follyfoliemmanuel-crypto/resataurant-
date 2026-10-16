import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Filet de sécurité : une erreur d'affichage ne laisse plus un écran blanc, la page peut être rechargée en un clic. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 font-sans">
        <div className="max-w-sm w-full bg-white rounded-3xl border border-stone-200 shadow-lg p-8 text-center space-y-4">
          <h1 className="text-xl font-black text-stone-900">Oups, un souci d’affichage</h1>
          <p className="text-sm text-stone-500">La page a rencontré une erreur inattendue. Vos données sont en sécurité.</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3 rounded-xl text-sm cursor-pointer"
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full text-xs font-semibold text-stone-500 hover:text-stone-900 py-2 cursor-pointer"
            >
              Recharger la page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
