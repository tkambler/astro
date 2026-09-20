#!/usr/bin/env bash

safehouse \
    --enable=chromium-full \
    --enable=chromium-headless \
    --enable=agent-browser \
    --enable=browser-native-messaging \
    --enable=process-control \
    --enable=docker \
    --enable=wide-read \
    --enable=xcode \
    --enable=shell-init \
    --enable=all-apps \
    --add-dirs=~/Library/Caches \
    --add-dirs=/Applications/Docker.app \
    --add-dirs=~/bin \
    --add-dirs=~/.codex \
    --add-dirs-ro=~/.config \
    --add-dirs-ro=~/repos/bible \
    --enable=all-agents \
    codex --yolo "$@"