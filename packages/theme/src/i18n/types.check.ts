import { t } from './index';

t('common.action.cancel.label');
t('format.relative.justNow');

// @ts-expect-error unknown key fails typecheck
t('common.action.doesNotExist.label');

// @ts-expect-error typo in a key segment fails typecheck
t('common.action.cancle.label');

// @ts-expect-error a namespace is not a leaf
t('common.action');
