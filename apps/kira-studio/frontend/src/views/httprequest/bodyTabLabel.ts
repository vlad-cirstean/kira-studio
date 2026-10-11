import type { HttpRequestTabState } from '@shared/domain/http';
import { t } from '@theme/i18n';

const isNamed = (f: { enabled: boolean; name: string }): boolean =>
  f.enabled && f.name.trim() !== '';

export function bodyTabLabel(state: HttpRequestTabState): string {
  const plain = t('studio.http.pane.body.label');
  switch (state.bodyMode) {
    case 'none':
      return plain;
    case 'raw':
      return t('studio.http.pane.bodyRaw.label');
    case 'code':
      return t(
        state.codeLanguage === 'json'
          ? 'studio.http.pane.bodyJson.label'
          : 'studio.http.pane.bodyCode.label',
      );
    case 'urlencoded': {
      const count = state.urlEncoded.filter(isNamed).length;
      return count > 0 ? t('studio.http.pane.bodyCount.label', { count }) : plain;
    }
    case 'formdata': {
      const count = state.formData.filter(isNamed).length;
      return count > 0 ? t('studio.http.pane.bodyCount.label', { count }) : plain;
    }
    case 'file':
      return state.binaryFile ? t('studio.http.pane.bodyFile.label') : plain;
  }
}
