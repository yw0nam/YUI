<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { withBase } from 'vitepress'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #not-found>
      <div class="yui-404">
        <p class="yui-404-code">404</p>
        <p class="yui-404-title">Nothing lives at this address.</p>
        <p class="yui-404-sub">
          The page moved or never existed. YUI looked; the corner is empty.
        </p>
        <a :href="withBase('/')" class="yui-404-home">Take me home</a>
      </div>
    </template>
  </Layout>
</template>
