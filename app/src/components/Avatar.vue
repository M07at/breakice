<script setup lang="ts">
import type { AvatarConfig } from '../types/room'

withDefaults(defineProps<{ avatar: AvatarConfig; size?: 'small' | 'medium' | 'large' }>(), {
  size: 'medium',
})
</script>

<template>
  <view :class="['avatar', `avatar-${size}`]">
    <view :class="['avatar-face', `skin-${avatar.skin}`]">
      <view :class="['hair', `hair-${avatar.hair}`]" />
      <view :class="['eyes', `eyes-${avatar.eyes}`]">
        <view class="eye eye-left" />
        <view class="eye eye-right" />
      </view>
      <view :class="['nose', `nose-${avatar.nose}`]" />
      <view :class="['mouth', `mouth-${avatar.mouth}`]" />
      <view v-if="avatar.accessory === 'glasses'" class="glasses">
        <view class="glass glass-left" />
        <view class="glass glass-right" />
        <view class="glass-bridge" />
      </view>
      <view v-else-if="avatar.accessory === 'star'" class="star">✦</view>
      <view v-else-if="avatar.accessory === 'headphones'" class="headphones" />
    </view>
  </view>
</template>

<style scoped>
.avatar {
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  background: #eef0ff;
}

.avatar-small { width: 58rpx; height: 58rpx; }
.avatar-medium { width: 72rpx; height: 72rpx; }
.avatar-large { width: 168rpx; height: 168rpx; }

.avatar-face {
  position: absolute;
  left: 12%;
  top: 15%;
  width: 76%;
  height: 76%;
  border-radius: 48% 48% 44% 44%;
}

.skin-light { background: #f8d6b8; }
.skin-warm { background: #eeb78f; }
.skin-tan { background: #c98762; }
.skin-deep { background: #8b543f; }

.hair {
  position: absolute;
  z-index: 2;
  left: -3%;
  top: -10%;
  width: 106%;
  height: 42%;
  background: #342b38;
}

.hair-short { border-radius: 52% 52% 34% 34%; }
.hair-bob { height: 58%; border-radius: 48% 48% 38% 38%; }
.hair-curly { border-radius: 48%; box-shadow: -10rpx 10rpx 0 #342b38, 10rpx 8rpx 0 #342b38; }
.hair-cap { height: 30%; border-radius: 50% 50% 22% 22%; background: #4f46e5; }

.eyes {
  position: absolute;
  z-index: 3;
  left: 23%;
  top: 42%;
  display: flex;
  justify-content: space-between;
  width: 54%;
}

.eye {
  width: 13%;
  height: 13%;
  min-width: 5rpx;
  min-height: 5rpx;
  border-radius: 50%;
  background: #342b38;
}

.eyes-happy .eye { height: 5rpx; border-radius: 100% 100% 0 0; background: transparent; border-top: 4rpx solid #342b38; }
.eyes-wink .eye-right { height: 5rpx; margin-top: 4rpx; border-radius: 100% 100% 0 0; background: transparent; border-top: 4rpx solid #342b38; }

.nose {
  position: absolute;
  z-index: 3;
  left: 48%;
  top: 52%;
  width: 6%;
  height: 8%;
  border-radius: 50%;
  background: rgba(112, 61, 49, 0.32);
}

.nose-small { width: 10%; height: 5%; border-radius: 50%; }
.nose-triangle { width: 0; height: 0; border-right: 6rpx solid transparent; border-left: 6rpx solid transparent; border-top: 10rpx solid rgba(112, 61, 49, 0.4); background: transparent; }

.mouth {
  position: absolute;
  z-index: 3;
  left: 42%;
  top: 70%;
  width: 16%;
  height: 7%;
  border-bottom: 4rpx solid #8e4d4b;
  border-radius: 0 0 50% 50%;
}

.mouth-open { width: 14%; height: 12%; border: 0; border-radius: 50%; background: #8e4d4b; }
.mouth-line { width: 16%; height: 0; border-bottom: 4rpx solid #8e4d4b; border-radius: 0; }

.glasses, .headphones { position: absolute; z-index: 4; inset: 0; }
.glass { position: absolute; top: 39%; width: 28%; height: 20%; border: 4rpx solid #342b38; border-radius: 35%; }
.glass-left { left: 10%; }
.glass-right { right: 10%; }
.glass-bridge { position: absolute; left: 37%; top: 47%; width: 26%; height: 4rpx; background: #342b38; }
.star { position: absolute; z-index: 5; right: 4%; top: 1%; color: #f3b62f; font-size: 25%; }
.headphones { border: 7rpx solid #e05d78; border-bottom: 0; border-radius: 50% 50% 0 0; }

.avatar-small .star { font-size: 18rpx; }
.avatar-small .headphones { border-width: 3rpx; }
</style>
