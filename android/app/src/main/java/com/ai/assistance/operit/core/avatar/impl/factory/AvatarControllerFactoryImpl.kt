package com.ai.assistance.operit.core.avatar.impl.factory

import androidx.compose.runtime.Composable
import com.ai.assistance.operit.core.avatar.common.control.AvatarController
import com.ai.assistance.operit.core.avatar.common.factory.AvatarControllerFactory
import com.ai.assistance.operit.core.avatar.common.model.AvatarModel
import com.ai.assistance.operit.core.avatar.common.model.AvatarType
import com.ai.assistance.operit.core.avatar.impl.gltf.control.rememberGltfAvatarController
import com.ai.assistance.operit.core.avatar.impl.gltf.model.GltfAvatarModel
import com.ai.assistance.operit.core.avatar.impl.mp4.control.rememberMp4AvatarController
import com.ai.assistance.operit.core.avatar.impl.mp4.model.Mp4AvatarModel
import com.ai.assistance.operit.core.avatar.impl.webp.control.rememberWebPAvatarController
import com.ai.assistance.operit.core.avatar.impl.webp.model.WebPAvatarModel

class AvatarControllerFactoryImpl : AvatarControllerFactory {

    @Composable
    override fun createController(model: AvatarModel): AvatarController? {
        return when (model.type) {
            AvatarType.WEBP -> {
                val webpModel = model as? WebPAvatarModel
                if (webpModel != null) {
                    rememberWebPAvatarController(webpModel)
                } else {
                    null
                }
            }
            AvatarType.MP4 -> {
                val mp4Model = model as? Mp4AvatarModel
                if (mp4Model != null) {
                    rememberMp4AvatarController(mp4Model)
                } else {
                    null
                }
            }
            AvatarType.GLTF -> {
                val gltfModel = model as? GltfAvatarModel
                if (gltfModel != null) {
                    rememberGltfAvatarController(gltfModel)
                } else {
                    null
                }
            }
            else -> null
        }
    }

    override fun canCreateController(model: AvatarModel): Boolean {
        return when (model.type) {
            AvatarType.WEBP -> model is WebPAvatarModel
            AvatarType.MP4 -> model is Mp4AvatarModel
            AvatarType.GLTF -> model is GltfAvatarModel
            else -> false
        }
    }

    override val supportedTypes: List<String>
        get() = listOf(
            AvatarType.WEBP.name,
            AvatarType.MP4.name,
            AvatarType.GLTF.name
        )
}
