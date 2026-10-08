import { createRouter, createWebHistory } from 'vue-router';
import AppShell from './AppShell.vue';
import BacklogScreen from './screens/BacklogScreen.vue';
import NeedsScreen from './screens/NeedsScreen.vue';
import PairScreen from './screens/PairScreen.vue';
import PlanScreen from './screens/PlanScreen.vue';
import { useAuthStore } from './state/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/pair', name: 'pair', component: PairScreen },
    {
      path: '/',
      name: 'home',
      component: AppShell,
      redirect: '/needs',
      children: [
        { path: 'backlog', component: BacklogScreen },
        { path: 'needs', component: NeedsScreen },
        { path: 'plan', component: PlanScreen },
      ],
    },
  ],
});

// Every route but /pair needs a paired device; the first navigation waits for the /api/me check.
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (auth.phase === 'checking') await auth.check();
  if (to.name !== 'pair' && auth.phase !== 'paired') return { name: 'pair' };
  if (to.name === 'pair' && auth.phase === 'paired') return { name: 'home' };
  return true;
});
