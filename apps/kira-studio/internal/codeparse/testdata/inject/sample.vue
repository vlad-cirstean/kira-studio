<template>
  <div>{{ label }}</div>
</template>

<script setup>
function greet(name) {
  return helper(name);
}
</script>

<style scoped>
.label {
  color: red;
}
</style>
